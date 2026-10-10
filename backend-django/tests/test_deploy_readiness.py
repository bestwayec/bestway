"""Run the real cutover readiness function against a simulated edge restart."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'deploy_django.sh'
GIT_BASH = Path('C:/Program Files/Git/bin/bash.exe')
BASH = str(GIT_BASH) if os.name == 'nt' and GIT_BASH.exists() else shutil.which('bash')
pytestmark = pytest.mark.skipif(not BASH, reason='Bash is required for deployment regressions')


def readiness_function():
    source = SCRIPT.read_text(encoding='utf-8')
    return 'wait_for_public_readiness() {' + source.split('wait_for_public_readiness() {', 1)[1].split('\n}', 1)[0] + '\n}'


MOCKS = r'''
set -euo pipefail
nest=(mock_nest)
django=(mock_django)
mock_nest() {
  printf 'internal\n' >> probes
  if [[ "$SCENARIO" == frontend && ! -f frontend_started ]]; then
    touch frontend_started
    return 1
  fi
}
mock_django() {
  printf 'validate\n' >> probes
  while [[ "$1" != python ]]; do shift; done
  shift
  "$TEST_PYTHON" "$@"
}
curl() {
  if [[ "${@: -1}" == https://api.bestwayec.uz/v1/health ]]; then
    local attempt=0
    [[ ! -f api_attempt ]] || read -r attempt < api_attempt
    attempt=$((attempt+1))
    printf '%s\n' "$attempt" > api_attempt
    printf 'api\n' >> probes
    if [[ "$SCENARIO" == permanent || ( "$SCENARIO" == transient && "$attempt" == 1 ) ]]; then
      return 22 # curl --fail on Cloudflare HTTP 530
    elif [[ "$SCENARIO" == wrong || ( "$SCENARIO" == transient && "$attempt" == 2 ) ]]; then
      printf '{"data":{"buildCommit":"old-release"}}'
    elif [[ "$SCENARIO" == malformed && "$attempt" == 1 ]]; then
      printf '<html>Starting up</html>'
    else
      printf '{"data":{"buildCommit":"%s"}}' "$BUILD_COMMIT"
    fi
  else
    printf 'site\n' >> probes
    if [[ "$SCENARIO" == site && ! -f site_started ]]; then
      touch site_started
      return 22
    fi
  fi
}
sleep() { printf 'sleep\n' >> probes; }
trap 'status=$?; if [[ "$status" != 0 ]]; then printf "rollback\n" > rollback; fi; exit "$status"' EXIT
'''


def run_readiness(tmp_path, scenario):
    env = dict(os.environ, SCENARIO=scenario, BUILD_COMMIT='a' * 40,
               TEST_PYTHON=sys.executable.replace('\\', '/'))
    result = subprocess.run([BASH, '-c', MOCKS + '\n' + readiness_function() +
                             '\nwait_for_public_readiness\nprintf "django\\n" > .bestway-runtime\n'],
                            cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30)
    probes = (tmp_path / 'probes').read_text().splitlines()
    assert 'Traceback' not in result.stderr
    return result, probes


def test_transient_530_then_wrong_release_then_expected_release(tmp_path):
    result, probes = run_readiness(tmp_path, 'transient')
    assert result.returncode == 0, result.stderr
    assert probes.count('api') == 3
    assert probes.count('validate') == 2  # No empty JSON parsing after curl failure.
    assert probes.count('site') == 1  # Old release never advances to website success.
    assert (tmp_path / '.bestway-runtime').read_text() == 'django\n'
    assert not (tmp_path / 'rollback').exists()


@pytest.mark.parametrize('scenario', ['frontend', 'site', 'malformed'])
def test_frontend_site_and_json_startup_are_retried(tmp_path, scenario):
    result, probes = run_readiness(tmp_path, scenario)
    assert result.returncode == 0, result.stderr
    assert probes.count('internal') == 2
    assert probes.count('sleep') == 1
    assert (tmp_path / '.bestway-runtime').exists()


@pytest.mark.parametrize('scenario', ['permanent', 'wrong'])
def test_permanent_failure_is_bounded_and_preserves_exit_recovery(tmp_path, scenario):
    result, probes = run_readiness(tmp_path, scenario)
    assert result.returncode == 1, result.stderr
    assert probes.count('api') == 30
    assert probes.count('sleep') == 29
    assert 'site' not in probes
    assert not (tmp_path / '.bestway-runtime').exists()
    assert (tmp_path / 'rollback').read_text() == 'rollback\n'


def test_cutover_script_bash_syntax():
    result = subprocess.run([BASH, '-n', str(SCRIPT)], capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
