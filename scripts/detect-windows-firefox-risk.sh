#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/release-state.sh
source "$SCRIPT_DIR/lib/release-state.sh"
# shellcheck source=lib/release-risk.sh
source "$SCRIPT_DIR/lib/release-risk.sh"

TARGET_SHA="$(release_risk_target_sha)"
resolve_release_risk_base_ref
CHANGED_FILES="$(list_release_risk_changed_files "${RELEASE_RISK_BASE_REF:-}" "$TARGET_SHA")"

echo "Release risk base source: ${RELEASE_RISK_BASE_SOURCE:-unknown}"
if [ -n "${RELEASE_RISK_BASE_REF:-}" ]; then
  echo "Release risk base ref: ${RELEASE_RISK_BASE_REF}"
else
  echo "Release risk base ref: (none)"
fi
echo "Release risk target SHA: $TARGET_SHA"

echo "Changed files since last release:"
if [ -n "$CHANGED_FILES" ]; then
  echo "$CHANGED_FILES"
else
  echo "(none)"
fi

HIGH_RISK=false
if release_risk_is_high "$CHANGED_FILES"; then
  HIGH_RISK=true
fi

emit_release_risk_outputs "${GITHUB_OUTPUT:-}" "$HIGH_RISK"
