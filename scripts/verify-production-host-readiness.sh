#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/deploy-container-platform.sh
source "$SCRIPT_DIR/lib/deploy-container-platform.sh"

require_cmd node
require_cmd ssh

usage() {
  cat <<'EOF'
Usage: bash scripts/verify-production-host-readiness.sh [deploy-host]

Read-only preflight for a production host candidate before updating DEPLOY_HOST
or creating a production tag. The host must be native amd64 while ARM64 release
images are discontinued.

Environment:
  DEPLOY_HOST                 Production host to check when no argument is passed
  DEPLOY_PORT                 SSH port (default: 22)
  DEPLOY_USER                 SSH user (default: deploy)
  DEPLOY_SSH_KEY              Private key path
  DEPLOY_SSH_CONFIG           SSH client config file (default: /dev/null)
  DEPLOY_SSH_STRICT_HOSTKEY   StrictHostKeyChecking value (default: accept-new)
EOF
}

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
fi

DEPLOY_HOST="${1:-${DEPLOY_HOST:-}}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"
DEPLOY_SSH_STRICT_HOSTKEY="${DEPLOY_SSH_STRICT_HOSTKEY:-accept-new}"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ -z "$DEPLOY_HOST" ]; then
  usage
  die "DEPLOY_HOST must be set or passed as the first argument" 1
fi

if [ -z "${DEPLOY_SSH_KEY:-}" ]; then
  die "DEPLOY_SSH_KEY must be set before checking production host readiness" 1
fi

DEPLOY_SSH_KEY="$(expand_tilde "$DEPLOY_SSH_KEY")"
if [ ! -f "$DEPLOY_SSH_KEY" ]; then
  die "Production SSH key not found: $DEPLOY_SSH_KEY" 1
fi

configure_deploy_container_platform "$(node "$SCRIPT_DIR/deploy-targets.mjs" get production containerPlatform)"

SSH_CMD=(
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

log_info "Checking production host candidate: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}"

"${SSH_CMD[@]}" 'bash -s' <<'REMOTE_CHECK'
set -euo pipefail

fail() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

info() {
  printf '[INFO] %s\n' "$*"
}

host_arch="$(uname -m 2>/dev/null || true)"
case "$host_arch" in
  x86_64|amd64)
    info "Host architecture is native amd64 ($host_arch)"
    ;;
  *)
    fail "Host architecture is $host_arch; ARM64 hosts are unsupported while ARM64 release images are discontinued"
    ;;
esac

for required_cmd in bash git docker; do
  command -v "$required_cmd" >/dev/null 2>&1 || fail "Missing required command: $required_cmd"
done

docker compose version >/dev/null 2>&1 || fail "Missing required Docker Compose plugin"

test -d /opt/classroompath || fail "Missing /opt/classroompath"
test -d /opt/classroompath/app/.git || fail "Missing git checkout at /opt/classroompath/app"
test -d /opt/classroompath/app/docker || fail "Missing compose directory at /opt/classroompath/app/docker"
test -r /opt/classroompath/app/config/.env || fail "Missing readable runtime env file at /opt/classroompath/app/config/.env"

if [ -f /opt/classroompath/release-state/current-images.env ]; then
  grep -q '^APP_SHA=' /opt/classroompath/release-state/current-images.env \
    || fail "Production current-images.env exists but does not include APP_SHA"
  info "Production release state is present"
else
  info "Production current-images.env is absent; first promotion will use git diff risk detection without a production-state base"
fi

git -C /opt/classroompath/app rev-parse --is-inside-work-tree >/dev/null
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable by this SSH user"

info "Production host candidate passed read-only readiness checks"
REMOTE_CHECK

log_success "Production host candidate is ready for linux/amd64 promotion gates"
