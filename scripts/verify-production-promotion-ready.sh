#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/release-manifest.sh
source "$SCRIPT_DIR/lib/release-manifest.sh"
# shellcheck source=lib/deploy-container-platform.sh
source "$SCRIPT_DIR/lib/deploy-container-platform.sh"

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
STAGING_SSH_CONFIG="${STAGING_SSH_CONFIG:-/dev/null}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"
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
  -F "$STAGING_SSH_CONFIG"
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=${STAGING_SSH_STRICT_HOSTKEY}"
  -i "$STAGING_SSH_KEY"
  -p "$STAGING_PORT"
  "${STAGING_USER}@${STAGING_HOST}"
)

verify_production_container_platform_ready() {
  local target_platform="${1:-linux/amd64}"
  local host_arch=""

  configure_deploy_container_platform "$target_platform"
  case "$CLASSROOMPATH_CONTAINER_PLATFORM" in
    linux/amd64|linux/arm64)
      host_arch="$("${PRODUCTION_SSH_CMD[@]}" "uname -m" | tr -d '\r\n')" || {
        die "Unable to detect production host architecture before tagging" 1
      }

      case "$CLASSROOMPATH_CONTAINER_PLATFORM:$host_arch" in
        linux/amd64:x86_64|linux/amd64:amd64|linux/arm64:aarch64|linux/arm64:arm64)
          log_info "Production host supports $CLASSROOMPATH_CONTAINER_PLATFORM containers natively ($host_arch)"
          return 0
          ;;
      esac

      die "Production host architecture $host_arch does not match target container platform $CLASSROOMPATH_CONTAINER_PLATFORM." 1
      ;;
    *)
      normalize_deploy_container_platform "$CLASSROOMPATH_CONTAINER_PLATFORM" >/dev/null
      ;;
  esac
}

PRODUCTION_SSH_CMD=()
if [ -z "${DEPLOY_HOST:-}" ]; then
  die "DEPLOY_HOST must be set before production promotion" 1
fi

if [ -z "${DEPLOY_SSH_KEY:-}" ]; then
  die "DEPLOY_SSH_KEY must be set before production promotion" 1
fi

DEPLOY_SSH_KEY="$(expand_tilde "$DEPLOY_SSH_KEY")"
if [ ! -f "$DEPLOY_SSH_KEY" ]; then
  die "Production SSH key not found: $DEPLOY_SSH_KEY" 1
fi

PRODUCTION_SSH_CMD=(
  ssh
  -F "$DEPLOY_SSH_CONFIG"
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=${DEPLOY_SSH_STRICT_HOSTKEY}"
  -i "$DEPLOY_SSH_KEY"
  -p "$DEPLOY_PORT"
  "${DEPLOY_USER}@${DEPLOY_HOST}"
)

verify_production_container_platform_ready "$(node "$SCRIPT_DIR/deploy-targets.mjs" get production containerPlatform)"

"${SSH_CMD[@]}" "cat /opt/classroompath/release-state/current-images.env" > "$current_state_file"
"${SSH_CMD[@]}" "cat /opt/classroompath/release-state/staging-verification.env" > "$verification_state_file"

if "${PRODUCTION_SSH_CMD[@]}" "test -f /opt/classroompath/release-state/current-images.env" >/dev/null 2>&1; then
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

if [ -n "${PROMOTION_EVIDENCE_DIR:-}" ]; then
  mkdir -p "$PROMOTION_EVIDENCE_DIR"
  install -m 600 "$current_state_file" "$PROMOTION_EVIDENCE_DIR/staging-current-images.env"
  install -m 600 "$verification_state_file" "$PROMOTION_EVIDENCE_DIR/staging-verification.env"
fi

log_success "Staging release for $TARGET_SHA is promotion-ready"
if [ -n "${PROMOTION_REPORT_JSON_PATH:-}" ]; then
  log_info "Structured report written to $PROMOTION_REPORT_JSON_PATH"
fi
