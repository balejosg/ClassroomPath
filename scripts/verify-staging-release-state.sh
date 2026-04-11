#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/release-state.sh
source "$SCRIPT_DIR/lib/release-state.sh"

load_release_state_env ./staging-release-state.env
load_release_state_env ./staging-verification.env

if [ "${IMAGE_SOURCE:-}" != "release-candidate" ]; then
  echo "::error::Staging is not running release candidate images (IMAGE_SOURCE=${IMAGE_SOURCE:-unset})"
  exit 1
fi

if [ "${APP_SHA:-}" != "$EXPECTED_APP_SHA" ]; then
  echo "::error::Staging APP_SHA (${APP_SHA:-unset}) does not match tag SHA ($EXPECTED_APP_SHA)"
  exit 1
fi
verify_current_release_state_matches_expected
verify_staging_release_evidence_matches_expected

if [ "$HIGH_RISK" = "true" ]; then
  verify_high_risk_staging_release_evidence
fi

emit_staging_release_evidence_outputs "${GITHUB_OUTPUT:-}"
