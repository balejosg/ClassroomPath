#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/deploy-container-platform.sh
source "$SCRIPT_DIR/lib/deploy-container-platform.sh"

require_cmd curl
require_cmd node
require_cmd ssh

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
fi

resolve_default_deploy_host() {
  local public_url
  public_url="$(node "$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl)"
  public_url="${public_url#http://}"
  public_url="${public_url#https://}"
  printf '%s\n' "${public_url%%/*}"
}

require_non_placeholder_url() {
  local label="$1"
  local url="$2"

  if [ -z "$url" ] || [[ "$url" == *".invalid"* ]]; then
    die "Production target preflight failed: $label is not configured with a real URL" 1
  fi
}

require_reachable_url() {
  local label="$1"
  local url="$2"

  require_non_placeholder_url "$label" "$url"
  curl --max-time 15 --retry 1 --retry-delay 1 -fsS -o /dev/null "$url" \
    || die "Production target preflight failed: $label is not reachable" 1
}

DEPLOY_HOST="${DEPLOY_HOST:-$(resolve_default_deploy_host)}"
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"
DEPLOY_SSH_STRICT_HOSTKEY="${DEPLOY_SSH_STRICT_HOSTKEY:-accept-new}"
CLASSROOMPATH_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-/opt/classroompath}"
PRODUCTION_CURRENT_STATE_PATH="${CLASSROOMPATH_DEPLOY_ROOT%/}/release-state/current-images.env"
DEFAULT_DEPLOY_SSH_KEY="$HOME/.ssh/classroompath_deploy"

if [ -z "${DEPLOY_SSH_KEY:-}" ] && [ -f "$DEFAULT_DEPLOY_SSH_KEY" ]; then
  DEPLOY_SSH_KEY="$DEFAULT_DEPLOY_SSH_KEY"
fi

if [ -z "$DEPLOY_USER" ]; then
  die "DEPLOY_USER must be set before production target preflight" 1
fi

if [ -z "${DEPLOY_SSH_KEY:-}" ]; then
  die "DEPLOY_SSH_KEY must be set before production target preflight" 1
fi

DEPLOY_SSH_KEY="$(expand_tilde "$DEPLOY_SSH_KEY")"
if [ ! -f "$DEPLOY_SSH_KEY" ]; then
  die "Production SSH key not found" 1
fi

production_public_url="$(node "$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl)"
production_health_url="$(node "$SCRIPT_DIR/deploy-targets.mjs" get production gatewayHealthUrl)"
production_ready_url="$(node "$SCRIPT_DIR/deploy-targets.mjs" get production readyUrl)"
production_container_platform="$(node "$SCRIPT_DIR/deploy-targets.mjs" get production containerPlatform)"

configure_deploy_container_platform "$production_container_platform"

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

log_info "Running read-only production target preflight..."

"${PRODUCTION_SSH_CMD[@]}" "true" >/dev/null \
  || die "Production target preflight failed: SSH is not reachable" 1

"${PRODUCTION_SSH_CMD[@]}" "test -r '$PRODUCTION_CURRENT_STATE_PATH' && grep -q '^APP_SHA=' '$PRODUCTION_CURRENT_STATE_PATH'" >/dev/null \
  || die "Production target preflight failed: production release state is not readable" 1

host_arch="$("${PRODUCTION_SSH_CMD[@]}" "uname -m" | tr -d '\r\n')" \
  || die "Production target preflight failed: host architecture could not be detected" 1

case "$CLASSROOMPATH_CONTAINER_PLATFORM:$host_arch" in
  linux/amd64:x86_64|linux/amd64:amd64|linux/arm64:aarch64|linux/arm64:arm64)
    ;;
  *)
    die "Production target preflight failed: host architecture does not match container platform" 1
    ;;
esac

require_reachable_url "production public URL" "$production_public_url"
require_reachable_url "production health URL" "$production_health_url"
require_reachable_url "production ready URL" "$production_ready_url"

if grep -q 'require_cmd node' "$SCRIPT_DIR/deploy-production-remote.sh"; then
  die "Production target preflight failed: remote production deploy requires host node" 1
fi

if ! grep -q 'classify_migration_risk_without_node()' "$SCRIPT_DIR/deploy-production-remote.sh" \
  || ! grep -q 'if command -v node >/dev/null 2>&1; then' "$SCRIPT_DIR/deploy-production-remote.sh"; then
  die "Production target preflight failed: remote production deploy lacks the no-host-node fallback" 1
fi

log_success "Production target preflight passed for deploy root $CLASSROOMPATH_DEPLOY_ROOT and $CLASSROOMPATH_CONTAINER_PLATFORM"
