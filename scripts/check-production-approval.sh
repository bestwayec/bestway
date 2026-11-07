#!/usr/bin/env bash
# Fail closed before a deployment job can access the production environment.
set -euo pipefail

if [[ "${GITHUB_EVENT_NAME:-}" != 'workflow_dispatch' ]]; then
  echo 'Production deployment requires a manual workflow dispatch.' >&2
  exit 1
fi
if [[ "${GITHUB_REF:-}" != 'refs/heads/main' ]]; then
  echo 'Production workflow must be dispatched from main.' >&2
  exit 1
fi
if [[ "${DEPLOY_CONFIRMATION:-}" != 'DEPLOY TO PRODUCTION' ]]; then
  echo 'Production deployment confirmation did not match.' >&2
  exit 1
fi
if [[ ! "${GITHUB_REPOSITORY:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo 'Invalid GitHub repository identifier.' >&2
  exit 1
fi

# GitHub can create a named environment with no protections by default. Verify
# the actual repository configuration instead of assuming the name protects it.
if ! command -v gh >/dev/null || ! command -v jq >/dev/null; then
  echo 'GitHub CLI and jq are required to check production protection.' >&2
  exit 1
fi
if ! protection="$(gh api "repos/${GITHUB_REPOSITORY}/environments/production")"; then
  echo 'Cannot verify production environment protection; deployment blocked.' >&2
  exit 1
fi
if ! printf '%s' "$protection" | jq -e '
  any(.protection_rules[]?;
    .type == "required_reviewers" and .prevent_self_review == true and
    ((.reviewers | type) == "array") and ((.reviewers | length) > 0))
' >/dev/null 2>&1; then
  echo 'Production requires configured reviewers and prevent-self-review protection.' >&2
  exit 1
fi
echo 'Manual request and production reviewer protection verified.'
