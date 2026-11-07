"""Deployment script behaviour: preflight, rollback and workflow safety."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'deploy-release.sh'
WORKFLOWS = ROOT / '.github' / 'workflows'
BASH = shutil.which('bash')
needs_linux_tools = pytest.mark.skipif(
    not (BASH and shutil.which('flock') and shutil.which('git') and shutil.which('timeout')),
    reason='bash, flock, git and timeout are required to execute the deployment script',
)

# Fake docker: logs every call; behaviour is driven by FAIL_ON (a substring of the
# joined arguments whose first match exits 1) so tests can fail one exact phase.
FAKE_DOCKER = r'''#!/usr/bin/env bash
args="$*"
printf '%s\n' "$args" >> "$DOCKER_LOG"
if [[ -n "${FAIL_ON:-}" && "$args" == *"$FAIL_ON"* && ! -e "$FAKE_DIR/failed-once" ]]; then
  touch "$FAKE_DIR/failed-once"; echo "simulated failure: $args" >&2; exit 1
fi
case "$args" in
  info*) echo /;;
  *" ps -q backend") echo cid-backend;;
  *" ps -q frontend") echo cid-frontend;;
  "inspect --format {{.Image}} cid-backend") echo sha256:oldbackend;;
  "inspect --format {{.Image}} cid-frontend") echo sha256:oldfrontend;;
  *"pg_dump"*) echo DUMP;;
esac
exit 0
'''


def make_release_checkout(tmp_path):
    repo = tmp_path / 'repo'
    (repo / 'scripts').mkdir(parents=True)
    (repo / 'backend-django').mkdir()
    shutil.copy(SCRIPT, repo / 'scripts' / 'deploy-release.sh')
    (repo / 'backend-django' / '.env').write_text('DJANGO_SECRET_KEY=test\n')
    (repo / '.gitignore').write_text('backend-django/.env\n.local/\nbackups/\n')
    git = ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false']
    subprocess.run([*git, 'init', '-q'], cwd=repo, check=True)
    subprocess.run([*git, 'add', '.'], cwd=repo, check=True)
    subprocess.run([*git, 'commit', '-qm', 'release'], cwd=repo, check=True)
    sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, check=True,
                         capture_output=True, text=True).stdout.strip()
    fake = tmp_path / 'bin'
    fake.mkdir()
    (fake / 'docker').write_text(FAKE_DOCKER)
    (fake / 'curl').write_text('#!/usr/bin/env bash\nexit 0\n')
    (fake / 'df').write_text('#!/usr/bin/env bash\necho header\necho "fs 1 1 99999999 1% /"\n')
    for tool in fake.iterdir():
        tool.chmod(0o755)
    return repo, sha, fake


def run_stage(tmp_path, repo, fake, stage, sha, **env_extra):
    log = tmp_path / 'docker.log'
    env = dict(os.environ, PATH=f'{fake}{os.pathsep}{os.environ["PATH"]}',
               DOCKER_LOG=str(log), FAKE_DIR=str(tmp_path), **env_extra)
    result = subprocess.run([BASH, str(repo / 'scripts' / 'deploy-release.sh'), stage, sha],
                            env=env, capture_output=True, text=True, timeout=60)
    calls = log.read_text().splitlines() if log.exists() else []
    return result, calls


def index_of(calls, needle):
    return next(i for i, call in enumerate(calls) if needle in call)


def test_invalid_release_fails_before_docker(tmp_path):
    docker = tmp_path / 'docker'
    docker.write_text('#!/bin/sh\ntouch "$DOCKER_CALLED"\n')
    docker.chmod(0o755)
    marker = tmp_path / 'called'
    env = dict(os.environ, PATH=f'{tmp_path}{os.pathsep}{os.environ["PATH"]}', DOCKER_CALLED=str(marker))
    result = subprocess.run([BASH or 'bash', str(SCRIPT), 'activate', 'not-a-sha'], env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'Invalid release SHA' in result.stderr
    assert not marker.exists()


def test_migrator_uses_installed_locked_cli():
    dockerfile = (ROOT / 'backend' / 'Dockerfile').read_text()
    assert 'npm ci --omit=dev' not in dockerfile
    assert './node_modules/.bin/prisma' in dockerfile


@needs_linux_tools
def test_prepare_pins_live_images_before_build_retags_them(tmp_path):
    repo, sha, fake = make_release_checkout(tmp_path)
    result, calls = run_stage(tmp_path, repo, fake, 'prepare', sha)
    assert result.returncode == 0, result.stderr
    build = index_of(calls, 'build db-migrator backend frontend')
    assert index_of(calls, 'tag sha256:oldbackend bestway-rollback/backend:previous') < build
    assert index_of(calls, 'tag sha256:oldfrontend bestway-rollback/frontend:previous') < build
    assert not any(' up ' in call for call in calls), 'prepare must never recreate live services'
    recorded = (repo / '.local' / 'rollback-images').read_text().split('\n')
    assert 'backend sha256:oldbackend' in recorded and 'frontend sha256:oldfrontend' in recorded
    assert (repo / '.local' / 'prepared-release').read_text().strip() == sha


@needs_linux_tools
def test_activate_imports_content_with_new_image_before_swapping_services(tmp_path):
    repo, sha, fake = make_release_checkout(tmp_path)
    assert run_stage(tmp_path, repo, fake, 'prepare', sha)[0].returncode == 0
    result, calls = run_stage(tmp_path, repo, fake, 'activate', sha)
    assert result.returncode == 0, result.stderr
    swap = index_of(calls, 'up -d --no-build --wait --wait-timeout 300 backend frontend')
    assert index_of(calls, 'pg_restore --list') < index_of(calls, 'run --rm --no-deps db-migrator')
    assert index_of(calls, 'manage.py migrate --noinput') < swap
    assert index_of(calls, 'run --rm --no-deps backend python manage.py import_cd_record_mock_1') < swap


@needs_linux_tools
def test_failed_health_check_after_swap_restores_previous_images(tmp_path):
    repo, sha, fake = make_release_checkout(tmp_path)
    assert run_stage(tmp_path, repo, fake, 'prepare', sha)[0].returncode == 0
    result, calls = run_stage(tmp_path, repo, fake, 'activate', sha, FAIL_ON='python -m config.healthcheck')
    assert result.returncode != 0
    assert 'ROLLED BACK' in result.stderr
    failure = index_of(calls, 'python -m config.healthcheck')
    restored = calls[failure:]
    assert 'tag sha256:oldbackend bestway-django:local' in restored
    assert 'tag sha256:oldfrontend bestway-frontend:local' in restored
    assert any('up -d --no-build --no-deps --wait' in call for call in restored)


@needs_linux_tools
def test_failed_migration_leaves_live_containers_untouched(tmp_path):
    repo, sha, fake = make_release_checkout(tmp_path)
    assert run_stage(tmp_path, repo, fake, 'prepare', sha)[0].returncode == 0
    result, calls = run_stage(tmp_path, repo, fake, 'activate', sha, FAIL_ON='manage.py migrate')
    assert result.returncode != 0
    assert 'Live application containers were not replaced' in result.stderr
    assert 'Backup: backups/before-release-' in result.stderr
    assert not any('backend frontend assessment-worker' in call and ' up ' in f' {call} ' for call in calls)
    assert not any(call.startswith('tag ') and call.endswith(':local') for call in calls)


@needs_linux_tools
def test_activate_refuses_a_release_that_was_not_prepared(tmp_path):
    repo, sha, fake = make_release_checkout(tmp_path)
    result, calls = run_stage(tmp_path, repo, fake, 'activate', sha)
    assert result.returncode != 0
    assert 'Release was not prepared' in result.stderr
    assert calls == []


def test_frontend_has_a_named_image_for_rollback():
    compose = (ROOT / 'docker-compose.yml').read_text()
    frontend = compose.split('\n  frontend:\n', 1)[1].split('\nvolumes:', 1)[0]
    assert 'image: bestway-frontend:local' in frontend
    assert compose.count('image: bestway-django:local') >= 4


def test_ci_cancels_only_superseded_pull_request_runs():
    text = (WORKFLOWS / 'ci.yml').read_text()
    assert 'concurrency:' in text
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in text


@pytest.mark.parametrize('filename', ['ci.yml', 'deploy.yml', 'deploy-django.yml'])
def test_workflows_pin_the_runner_image(filename):
    text = (WORKFLOWS / filename).read_text()
    assert 'ubuntu-latest' not in text
    assert 'runs-on: ubuntu-24.04' in text


def test_production_deploys_never_cancel_and_verify_public_endpoints():
    text = (WORKFLOWS / 'deploy.yml').read_text()
    assert 'group: bestway-production-deploy\n  cancel-in-progress: false' in text
    assert 'https://bestwayec.uz/' in text and 'https://api.bestwayec.uz/v1/health' in text
    assert 'bash scripts/deploy-release.sh prepare' in text
    assert 'bash scripts/deploy-release.sh activate' in text
