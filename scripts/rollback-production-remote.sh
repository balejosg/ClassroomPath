#!/usr/bin/env bash

set -euo pipefail

default_classroompath_deploy_root() {
  printf '/%s/%s\n' opt classroompath
}

CLASSROOMPATH_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-$(default_classroompath_deploy_root)}"
APP_DIR="${APP_DIR:-$CLASSROOMPATH_DEPLOY_ROOT/app}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
COMMON_SH_DEPLOYED_PATH="$APP_DIR/scripts/lib/common.sh"

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  SCRIPT_DIR="$APP_DIR/scripts"
fi

REMOTE_BOOTSTRAP_HELPER_PATH="$SCRIPT_DIR/lib/remote-bootstrap.sh"
if [ ! -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  REMOTE_BOOTSTRAP_HELPER_PATH="$APP_DIR/scripts/lib/remote-bootstrap.sh"
fi

if [ ! -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  printf 'Remote bootstrap helper not found: %s\n' "$REMOTE_BOOTSTRAP_HELPER_PATH" >&2
  exit 1
fi

# shellcheck source=lib/remote-bootstrap.sh
source "$REMOTE_BOOTSTRAP_HELPER_PATH"

SCRIPT_DIR="$(resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE")"
REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-deploy-scaffold.sh")"
if [ ! -f "$REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH" ]; then
  printf 'Remote deploy scaffold helper not found: %s\n' "$REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH" >&2
  exit 1
fi

# shellcheck source=lib/remote-deploy-scaffold.sh
source "$REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH"
remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"
remote_deploy_init_production_helper_paths "$SCRIPT_DIR" "$APP_DIR"

if [ ! -f "$REMOTE_HELPER_CONTRACTS_PATH" ]; then
  printf 'Remote helper contract helper not found: %s\n' "$REMOTE_HELPER_CONTRACTS_PATH" >&2
  exit 1
fi

# shellcheck source=lib/remote-helper-contracts.sh
source "$REMOTE_HELPER_CONTRACTS_PATH"

if [ ! -f "$COMMON_SH_PATH" ]; then
  printf 'Shared common helper not found: %s\n' "$COMMON_SH_PATH" >&2
  exit 1
fi

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"

DEPLOY_CONTAINER_PLATFORM_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-container-platform.sh")"
if [ ! -f "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH" ]; then
  printf 'Deploy container platform helper not found: %s\n' "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH" >&2
  exit 1
fi

# shellcheck source=lib/deploy-container-platform.sh
source "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH"

if release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
else
  log_error "Remote release-state helpers do not meet the minimum runtime contract"
  exit 1
fi

if release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
  # shellcheck source=lib/release-runtime.sh
  source "$RELEASE_RUNTIME_HELPER_PATH"
else
  log_error "Remote release-runtime helpers do not meet the minimum runtime contract"
  exit 1
fi

if deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
  # shellcheck source=lib/deployment-state.sh
  source "$DEPLOYMENT_STATE_HELPER_PATH"
else
  log_error "Remote deployment-state helper does not meet the minimum contract"
  exit 1
fi

refresh_rollback_checked_out_helpers() {
  remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"
  remote_deploy_init_production_helper_paths "$SCRIPT_DIR" "$APP_DIR"

  if ! deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
    log_error "Checked-out deployment-state helper does not meet the minimum contract"
    exit 1
  fi

  # shellcheck source=lib/deployment-state.sh
  source "$DEPLOYMENT_STATE_HELPER_PATH"

  if ! release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
    log_error "Checked-out release-runtime helper does not meet the minimum runtime contract"
    exit 1
  fi

  # shellcheck source=lib/release-runtime.sh
  source "$RELEASE_RUNTIME_HELPER_PATH"
}

DEPLOY_DIR="$CLASSROOMPATH_DEPLOY_ROOT"
STATE_DIR="$DEPLOY_DIR/release-state"
deployment_state_init_paths "$STATE_DIR"
deployment_state_load_previous_release

if [ -z "${APP_SHA:-}" ] || [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ]; then
  log_error "Previous release metadata is incomplete"
  exit 1
fi

ROLLBACK_RELEASE_APP_SHA="$APP_SHA"
ROLLBACK_RELEASE_IMAGE_SOURCE="${IMAGE_SOURCE:-}"
deployment_state_load_context
APP_SHA="$ROLLBACK_RELEASE_APP_SHA"
IMAGE_SOURCE="$ROLLBACK_RELEASE_IMAGE_SOURCE"

if [ -n "${MIGRATION_RISK_LEVEL:-}" ] || [ -n "${DB_MIGRATED:-}" ] || [ -n "${PRODUCTION_BACKUP_REFERENCE:-}" ]; then
  log_warn "Rollback context: migration risk=${MIGRATION_RISK_LEVEL:-unknown}, db_migrated=${DB_MIGRATED:-unknown}, backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
fi

cd "$APP_DIR"
git fetch origin --tags --prune
git fetch origin main --prune
git checkout --detach "$APP_SHA"
git reset --hard "$APP_SHA"
git submodule deinit -f --all || true
git submodule update --init --recursive --force
refresh_rollback_checked_out_helpers

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-production
configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/arm64}"
verify_deploy_container_platform
upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"
upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"
upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release

log_info "Pulling previous immutable images for rollback..."
prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "$APP_SHA"
docker compose pull gateway api spa
log_info "Recreating containers from previous release state..."
docker compose up -d --force-recreate --no-build

deployment_state_activate_previous_release

for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
    log_success "Rollback health check passed"
    exit 0
  fi

  log_warn "Rollback health check attempt $i failed, retrying..."
  sleep 5
done

log_error "Rollback health check failed"
docker logs classroompath-gateway --tail 50
exit 1
