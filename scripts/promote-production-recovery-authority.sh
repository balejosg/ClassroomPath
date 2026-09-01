#!/usr/bin/env bash

set -euo pipefail

# PRODUCTION_RECOVERY_VARIABLES_TOKEN is an environment secret containing a
# dedicated GitHub App/PAT credential with repository permission Variables: write.
# It is intentionally not GITHUB_TOKEN and has no fallback.

promotion_failed() {
  printf 'PRODUCTION_RECOVERY_PROMOTED=false\n'
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

recovery_sha="${PRODUCTION_RECOVERY_SHA:-}"
repository="${GITHUB_REPOSITORY:-}"

if [[ ! "$recovery_sha" =~ ^[0-9a-f]{40}$ ]]; then
  promotion_failed 'PRODUCTION_RECOVERY_SHA must be a full lowercase Git SHA-1 (40 hexadecimal characters)'
fi
if [[ ! "$repository" =~ ^[^/]+/[^/]+$ ]]; then
  promotion_failed 'GITHUB_REPOSITORY must identify an owner and repository'
fi
if [ -z "${PRODUCTION_RECOVERY_VARIABLES_TOKEN:-}" ]; then
  promotion_failed 'PRODUCTION_RECOVERY_VARIABLES_TOKEN must be provided by the protected environment secret'
fi
if ! command -v gh >/dev/null 2>&1; then
  promotion_failed 'gh CLI is required to promote the recovery authority'
fi

export GH_TOKEN="$PRODUCTION_RECOVERY_VARIABLES_TOKEN"

if ! gh variable set PRODUCTION_RECOVERY_SHA --repo "$repository" --body "$recovery_sha"; then
  promotion_failed 'repository variable write failed; recovery authority promotion is not confirmed'
fi

persisted_sha=""
if ! persisted_sha="$(gh variable get PRODUCTION_RECOVERY_SHA --repo "$repository" --json value --jq '.value')"; then
  promotion_failed 'repository variable read-back failed; recovery authority promotion is not confirmed'
fi
if [ "$persisted_sha" != "$recovery_sha" ]; then
  promotion_failed 'repository variable read-back does not match the approved recovery SHA'
fi

printf 'PRODUCTION_RECOVERY_PROMOTED=true\n'
