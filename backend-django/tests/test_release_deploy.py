"""Deployment preflight must reject unsafe inputs before touching Docker."""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'deploy-release.sh'


def test_invalid_release_fails_before_docker(tmp_path):
    docker = tmp_path / 'docker'
    docker.write_text('#!/bin/sh\ntouch "$DOCKER_CALLED"\n')
    docker.chmod(0o755)
    marker = tmp_path / 'called'
    env = dict(os.environ, PATH=f'{tmp_path}:{os.environ["PATH"]}', DOCKER_CALLED=str(marker))
    result = subprocess.run(['bash', str(SCRIPT), 'activate', 'not-a-sha'], env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'Invalid release SHA' in result.stderr
    assert not marker.exists()


def test_migrator_uses_installed_locked_cli():
    dockerfile = (ROOT / 'backend' / 'Dockerfile').read_text()
    assert 'npm ci --omit=dev' not in dockerfile
    assert './node_modules/.bin/prisma' in dockerfile
