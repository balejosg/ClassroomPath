#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/release-manifest.sh
source "$SCRIPT_DIR/lib/release-manifest.sh"

require_cmd git
require_cmd node
require_cmd ssh

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
fi

STAGING_HOST="${STAGING_HOST:-192.168.1.114}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SSH_STRICT_HOSTKEY="${DEPLOY_SSH_STRICT_HOSTKEY:-accept-new}"

if [ -z "${STAGING_SSH_KEY:-}" ]; then
  die "STAGING_SSH_KEY not set (set it in .env.local or export it)" 1
fi

STAGING_SSH_KEY="$(expand_tilde "$STAGING_SSH_KEY")"
if [ ! -f "$STAGING_SSH_KEY" ]; then
  die "SSH key not found: $STAGING_SSH_KEY" 1
fi

cd "$PROJECT_ROOT"
git fetch origin main --quiet
TARGET_SHA="${TARGET_SHA:-$(git rev-parse origin/main)}"

release_manifest_file="$(mktemp)"
current_state_file="$(mktemp)"
verification_state_file="$(mktemp)"
production_state_file="$(mktemp)"
risk_output_file="$(mktemp)"
report_json_file="${PROMOTION_REPORT_JSON_PATH:-$(mktemp)}"

cleanup() {
  rm -f "$release_manifest_file" "$current_state_file" "$verification_state_file" "$production_state_file" "$risk_output_file"
  if [ -z "${PROMOTION_REPORT_JSON_PATH:-}" ]; then
    rm -f "$report_json_file"
  fi
}
trap cleanup EXIT

node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest \
  --sha "$TARGET_SHA" \
  --output-file "$release_manifest_file" >/dev/null

release_manifest_validate_contract "$release_manifest_file" "$TARGET_SHA"
export_release_manifest_runtime_env "$release_manifest_file"

export EXPECTED_APP_SHA="$RELEASE_MANIFEST_APP_SHA"
export EXPECTED_GATEWAY_IMAGE="$CLASSROOMPATH_GATEWAY_IMAGE"
export EXPECTED_MIGRATIONS_IMAGE="$CLASSROOMPATH_MIGRATIONS_IMAGE"
export EXPECTED_OPENPATH_API_IMAGE="$OPENPATH_API_IMAGE"
export EXPECTED_OPENPATH_VERSION="$OPENPATH_VERSION"
export EXPECTED_OPENPATH_LINUX_AGENT_VERSION="$OPENPATH_LINUX_AGENT_VERSION"
export EXPECTED_SPA_IMAGE="$CLASSROOMPATH_SPA_IMAGE"

SSH_CMD=(
  ssh
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=${STAGING_SSH_STRICT_HOSTKEY}"
  -i "$STAGING_SSH_KEY"
  -p "$STAGING_PORT"
  "${STAGING_USER}@${STAGING_HOST}"
)

PRODUCTION_SSH_CMD=()
if [ -n "${DEPLOY_HOST:-}" ] && [ -n "${DEPLOY_SSH_KEY:-}" ]; then
  DEPLOY_SSH_KEY="$(expand_tilde "$DEPLOY_SSH_KEY")"
  if [ -f "$DEPLOY_SSH_KEY" ]; then
    PRODUCTION_SSH_CMD=(
      ssh
      -o "ConnectTimeout=10"
      -o "BatchMode=yes"
      -o "IdentitiesOnly=yes"
      -o "StrictHostKeyChecking=${DEPLOY_SSH_STRICT_HOSTKEY}"
      -i "$DEPLOY_SSH_KEY"
      -p "$DEPLOY_PORT"
      "${DEPLOY_USER}@${DEPLOY_HOST}"
    )
  fi
fi

"${SSH_CMD[@]}" "cat /opt/classroompath/release-state/current-images.env" > "$current_state_file"
"${SSH_CMD[@]}" "cat /opt/classroompath/release-state/staging-verification.env" > "$verification_state_file"

if [ "${#PRODUCTION_SSH_CMD[@]}" -gt 0 ] && "${PRODUCTION_SSH_CMD[@]}" "test -f /opt/classroompath/release-state/current-images.env" >/dev/null 2>&1; then
  "${PRODUCTION_SSH_CMD[@]}" "cat /opt/classroompath/release-state/current-images.env" > "$production_state_file" || true
fi

PRODUCTION_RELEASE_STATE_PATH="$production_state_file" \
TARGET_SHA="$TARGET_SHA" \
GITHUB_OUTPUT="$risk_output_file" \
node "$SCRIPT_DIR/release-risk-cli.mjs" detect-github-output >/dev/null

HIGH_RISK="$(awk -F= '$1=="high_risk"{print $2}' "$risk_output_file" | tail -1)"

node "$SCRIPT_DIR/release-state-cli.mjs" verify-promotion-ready \
  --current "$current_state_file" \
  --verification "$verification_state_file" \
  --deployment-mode promotion-eligible \
  --high-risk "${HIGH_RISK:-false}" \
  --report-json "$report_json_file"

log_success "Staging release for $TARGET_SHA is promotion-ready"
if [ -n "${PROMOTION_REPORT_JSON_PATH:-}" ]; then
  log_info "Structured report written to $PROMOTION_REPORT_JSON_PATH"
fi
