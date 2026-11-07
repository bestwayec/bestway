"""Production workflows require an explicit request and real reviewer protection."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'check-production-approval.sh'
BASH = shutil.which('bash')
JQ = shutil.which('jq')
pytestmark = pytest.mark.skipif(not BASH or not JQ, reason='Bash and jq are required')


def run_preflight(tmp_path, *, event='workflow_dispatch', confirmation='DEPLOY TO PRODUCTION',
                  rules=None, api_exit=0, repository='bestwayec/bestway', ref='refs/heads/main'):
    fake = tmp_path / 'gh'
    fake.write_text('#!/usr/bin/env bash\nprintf "called\\n" >> "$GH_CALLS"\n'
                    'printf "%s" "$GH_RESPONSE"\nexit "$GH_EXIT"\n')
    fake.chmod(0o755)
    env = dict(os.environ, PATH=str(tmp_path) + os.pathsep + os.environ['PATH'],
               GITHUB_EVENT_NAME=event, GITHUB_REPOSITORY=repository,
               GITHUB_REF=ref,
               DEPLOY_CONFIRMATION=confirmation, GH_CALLS=str(tmp_path / 'calls'),
               GH_RESPONSE=json.dumps({'protection_rules': rules or []}), GH_EXIT=str(api_exit))
    result = subprocess.run([BASH, str(SCRIPT)], env=env, capture_output=True, text=True, timeout=10)
    return result, (tmp_path / 'calls').exists()


def rule(*, reviewers=None, prevent=True):
    return {'type': 'required_reviewers', 'prevent_self_review': prevent,
            'reviewers': reviewers if reviewers is not None else [{'type': 'User', 'reviewer': {'id': 42}}]}


def test_reviewers_must_approve_a_manual_request(tmp_path):
    result, called = run_preflight(tmp_path, rules=[rule()])
    assert result.returncode == 0, result.stderr
    assert called


@pytest.mark.parametrize('event,confirmation,repository', [
    ('workflow_run', 'DEPLOY TO PRODUCTION', 'bestwayec/bestway'),
    ('push', 'DEPLOY TO PRODUCTION', 'bestwayec/bestway'),
    ('workflow_dispatch', '', 'bestwayec/bestway'),
    ('workflow_dispatch', 'deploy to production', 'bestwayec/bestway'),
    ('workflow_dispatch', 'DEPLOY TO PRODUCTION', '../wrong'),
])
def test_rejects_nonmanual_unconfirmed_or_invalid_requests_before_api(tmp_path, event, confirmation, repository):
    result, called = run_preflight(tmp_path, event=event, confirmation=confirmation, repository=repository)
    assert result.returncode != 0
    assert not called


def test_workflow_from_feature_branch_is_rejected(tmp_path):
    result, called = run_preflight(tmp_path, ref='refs/heads/feature')
    assert result.returncode != 0
    assert not called


@pytest.mark.parametrize('rules,api_exit', [
    ([], 0), ([rule(reviewers=[])], 0), ([rule(prevent=False)], 0),
    ([{'type': 'wait_timer', 'wait_timer': 1}], 0), ([rule()], 1),
])
def test_missing_reviewers_self_review_or_api_failure_blocks_deploy(tmp_path, rules, api_exit):
    result, called = run_preflight(tmp_path, rules=rules, api_exit=api_exit)
    assert result.returncode != 0
    assert called


@pytest.mark.parametrize('filename,job', [('deploy.yml', 'deploy'), ('deploy-django.yml', 'cutover')])
def test_deploy_workflow_is_manual_and_job_requires_protected_environment(filename, job):
    text = (ROOT / '.github' / 'workflows' / filename).read_text()
    event_block = text.split('\non:\n', 1)[1].split('\npermissions:', 1)[0]
    assert '  workflow_dispatch:\n' in event_block
    assert '  workflow_run:' not in event_block
    assert '  push:' not in event_block
    assert '      confirmation:' in event_block
    assert 'bash scripts/check-production-approval.sh' in text
    assert "  approval-preflight:\n    if: github.ref == 'refs/heads/main'\n" in text
    job_block = text.split(f'\n  {job}:\n', 1)[1]
    assert '    needs: approval-preflight\n' in job_block
    assert '    environment: production\n' in job_block
    assert 'gh api "repos/$REPO/actions/workflows/ci.yml/runs?' in job_block
    assert 'appleboy/ssh-action' in job_block
