#!/usr/bin/env bash

set -euo pipefail

: "${CLASSROOMPATH_DEPLOY_ROOT:?Set CLASSROOMPATH_DEPLOY_ROOT to the private production deploy root.}"
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

load_rollback_readiness_helper() {
  ROLLBACK_READINESS_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/rollback-readiness.sh")"
  if [ ! -f "$ROLLBACK_READINESS_HELPER_PATH" ]; then
    log_error "Rollback readiness helper not found: $ROLLBACK_READINESS_HELPER_PATH"
    return 1
  fi

  # shellcheck source=lib/rollback-readiness.sh
  source "$ROLLBACK_READINESS_HELPER_PATH"
}

load_rollback_readiness_helper || exit 1

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
  load_rollback_readiness_helper || exit 1
}

DEPLOY_DIR="$CLASSROOMPATH_DEPLOY_ROOT"
STATE_DIR="$DEPLOY_DIR/release-state"
deployment_state_init_paths "$STATE_DIR"
deployment_state_load_previous_release

if [ -z "${APP_SHA:-}" ] || [ -z "${IMAGE_SOURCE:-}" ] || [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}" ]; then
  log_error "Previous release metadata is incomplete for the canonical OpenPath installer lifecycle"
  exit 1
fi

case "$IMAGE_SOURCE" in
  release-candidate)
    if [[ ! "$OPENPATH_API_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
      log_error "Previous release OpenPath API image is not pinned by digest; refusing rollback"
      exit 1
    fi
    ;;
  source-build)
    ;;
  *)
    log_error "Previous release image source is not rollback-compatible: $IMAGE_SOURCE"
    exit 1
    ;;
esac

# Evaluate this before checkout or Docker mutation. An old ClassroomPath
# release without the canonical OpenPath installer pins is not eligible for
# automatic rollback, including after legacy DB/storage retirement.
require_windows_offline_installer_runtime_pin || exit 1

ROLLBACK_RELEASE_APP_SHA="$APP_SHA"
ROLLBACK_RELEASE_IMAGE_SOURCE="${IMAGE_SOURCE:-}"
deployment_state_load_context
APP_SHA="$ROLLBACK_RELEASE_APP_SHA"
IMAGE_SOURCE="$ROLLBACK_RELEASE_IMAGE_SOURCE"

if [ -n "${MIGRATION_RISK_LEVEL:-}" ] || [ -n "${DB_MIGRATED:-}" ] || [ -n "${PRODUCTION_BACKUP_REFERENCE:-}" ]; then
  log_warn "Rollback context: migration risk=${MIGRATION_RISK_LEVEL:-unknown}, db_migrated=${DB_MIGRATED:-unknown}, backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
fi

cd "$APP_DIR"
if ! git fetch origin --tags --prune; then
  log_error "Unable to fetch release tags for production rollback"
  exit 1
fi
if ! git fetch origin main --prune; then
  log_error "Unable to fetch origin/main for production rollback"
  exit 1
fi
if ! git checkout --detach "$APP_SHA"; then
  log_error "Unable to check out the previous production release"
  exit 1
fi
if ! git reset --hard "$APP_SHA"; then
  log_error "Unable to reset the production checkout to the previous release"
  exit 1
fi
if ! git submodule deinit -f --all; then
  log_error "Unable to clear the production OpenPath checkout before rollback"
  exit 1
fi
if ! git submodule update --init --recursive --force; then
  log_error "Unable to restore the production OpenPath checkout"
  exit 1
fi
if ! refresh_rollback_checked_out_helpers; then
  log_error "Unable to load the previous production release helpers"
  exit 1
fi
if ! require_windows_offline_installer_runtime_pin; then
  log_error "Previous production release does not meet the canonical installer contract"
  exit 1
fi

if ! echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin; then
  log_error "Unable to authenticate to the production container registry"
  exit 1
fi
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-production
if ! configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/arm64}"; then
  log_error "Unable to configure the production rollback container platform"
  exit 1
fi
if ! verify_deploy_container_platform; then
  log_error "Production rollback container platform verification failed"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"; then
  log_error "Unable to restore OPENPATH_VERSION for production rollback"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"; then
  log_error "Unable to restore OPENPATH_LINUX_AGENT_VERSION for production rollback"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}"; then
  log_error "Unable to restore the OpenPath installer template version for production rollback"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}"; then
  log_error "Unable to restore the OpenPath installer template commit for production rollback"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}"; then
  log_error "Unable to restore the OpenPath installer template release tag for production rollback"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256 "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}"; then
  log_error "Unable to restore the OpenPath installer template hash for production rollback"
  exit 1
fi
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release; then
  log_error "Unable to restore the OpenPath Firefox release root for production rollback"
  exit 1
fi

log_info "Pulling previous immutable images for rollback..."
if ! prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "$APP_SHA"; then
  log_error "Unable to restore OpenPath Firefox assets for production rollback"
  exit 1
fi
if ! docker compose pull gateway api windows-offline-installer-provision spa; then
  log_error "Unable to pull previous production rollback images"
  exit 1
fi
log_info "Recreating containers from previous release state..."
if ! docker compose up -d --force-recreate --no-build; then
  log_error "Unable to recreate the previous production release"
  exit 1
fi

if ! rollback_wait_for_health_and_readiness \
  "${PRODUCTION_ROLLBACK_PUBLIC_URL:-http://localhost:3001}" \
  "${PRODUCTION_ROLLBACK_READINESS_ATTEMPTS:-12}" \
  "${PRODUCTION_ROLLBACK_READINESS_DELAY_SECONDS:-5}" \
  "${PRODUCTION_ROLLBACK_CURL_TIMEOUT_SECONDS:-10}"; then
  log_error "Rollback health/readiness contract failed"
  docker logs classroompath-gateway --tail 50 || true
  exit 1
fi

if ! deployment_state_activate_previous_release; then
  log_error "Rollback passed health/readiness, but the previous release state could not be activated"
  exit 1
fi

log_success "Rollback health and readiness checks passed"
exit 0
