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
or creating a production tag. The host architecture must match the configured
production server container platform.

Environment:
  DEPLOY_HOST                 Production host to check when no argument is passed
  DEPLOY_PORT                 SSH port (default: 22)
  DEPLOY_USER                 SSH user (default: deploy)
  DEPLOY_SSH_KEY              Private key path
  DEPLOY_SSH_CONFIG           SSH client config file (default: /dev/null)
  DEPLOY_SSH_STRICT_HOSTKEY   StrictHostKeyChecking value (default: accept-new)
  CLASSROOMPATH_DEPLOY_ROOT   Production deploy root (default: /opt/classroompath)
EOF
}

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

DEPLOY_HOST="${1:-${DEPLOY_HOST:-$(resolve_default_deploy_host)}}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"
DEPLOY_SSH_STRICT_HOSTKEY="${DEPLOY_SSH_STRICT_HOSTKEY:-accept-new}"
CLASSROOMPATH_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-/opt/classroompath}"
DEFAULT_DEPLOY_SSH_KEY="$HOME/.ssh/classroompath_deploy"

if [ -z "${DEPLOY_SSH_KEY:-}" ] && [ -f "$DEFAULT_DEPLOY_SSH_KEY" ]; then
  DEPLOY_SSH_KEY="$DEFAULT_DEPLOY_SSH_KEY"
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ -z "$DEPLOY_HOST" ]; then
  usage
  die "DEPLOY_HOST must be set or passed as the first argument" 1
fi

if [ -z "$DEPLOY_USER" ]; then
  usage
  die "DEPLOY_USER must be set before checking production host readiness" 1
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

"${SSH_CMD[@]}" "TARGET_CONTAINER_PLATFORM=$CLASSROOMPATH_CONTAINER_PLATFORM CLASSROOMPATH_DEPLOY_ROOT='$CLASSROOMPATH_DEPLOY_ROOT' bash -s" <<'REMOTE_CHECK'
set -euo pipefail

fail() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

info() {
  printf '[INFO] %s\n' "$*"
}

verify_host_arch_matches_target_platform() {
  local target_platform="${TARGET_CONTAINER_PLATFORM:-}"
  local host_arch=""

  host_arch="$(uname -m 2>/dev/null || true)"
  case "$target_platform:$host_arch" in
    linux/amd64:x86_64|linux/amd64:amd64)
      info "Host architecture matches $target_platform ($host_arch)"
      return 0
      ;;
    linux/arm64:aarch64|linux/arm64:arm64)
      info "Host architecture matches $target_platform ($host_arch)"
      return 0
      ;;
  esac

  fail "Host architecture $host_arch does not match target container platform $target_platform"
}

verify_host_arch_matches_target_platform

deploy_root="${CLASSROOMPATH_DEPLOY_ROOT:-/opt/classroompath}"
app_dir="${deploy_root%/}/app"
state_dir="${deploy_root%/}/release-state"

for required_cmd in bash git docker; do
  command -v "$required_cmd" >/dev/null 2>&1 || fail "Missing required command: $required_cmd"
done

docker compose version >/dev/null 2>&1 || fail "Missing required Docker Compose plugin"

test -d "$deploy_root" || fail "Missing $deploy_root"
test -d "$app_dir/.git" || fail "Missing git checkout at $app_dir"
test -d "$app_dir/docker" || fail "Missing compose directory at $app_dir/docker"
test -r "$app_dir/config/.env" || fail "Missing readable runtime env file at $app_dir/config/.env"

if [ -f "$state_dir/current-images.env" ]; then
  grep -q '^APP_SHA=' "$state_dir/current-images.env" \
    || fail "Production current-images.env exists but does not include APP_SHA"
  info "Production release state is present"
else
  info "Production current-images.env is absent; first promotion will use git diff risk detection without a production-state base"
fi

git -C "$app_dir" rev-parse --is-inside-work-tree >/dev/null
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable by this SSH user"

info "Production host candidate passed read-only readiness checks"
REMOTE_CHECK

log_success "Production host candidate is ready for $CLASSROOMPATH_CONTAINER_PLATFORM promotion gates"
