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

: "${PRODUCTION_HOST_CONTRACT_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/production-host-contract.sh")}"
: "${DEPLOYMENT_TRANSACTION_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-transaction.sh")}"
: "${ROLLBACK_EXECUTOR_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/rollback-executor.sh")}"

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

if production_host_contract_helper_supports_contract "$PRODUCTION_HOST_CONTRACT_HELPER_PATH"; then
  # shellcheck source=lib/production-host-contract.sh
  source "$PRODUCTION_HOST_CONTRACT_HELPER_PATH"
else
  log_error "Remote production-host-contract helper does not meet the minimum contract"
  exit 1
fi

if deployment_transaction_helper_supports_contract "$DEPLOYMENT_TRANSACTION_HELPER_PATH"; then
  # shellcheck source=lib/deployment-transaction.sh
  source "$DEPLOYMENT_TRANSACTION_HELPER_PATH"
else
  log_error "Remote deployment-transaction helper does not meet the minimum contract"
  exit 1
fi

if rollback_executor_helper_supports_contract "$ROLLBACK_EXECUTOR_HELPER_PATH"; then
  # shellcheck source=lib/rollback-executor.sh
  source "$ROLLBACK_EXECUTOR_HELPER_PATH"
else
  log_error "Remote rollback-executor helper does not meet the minimum contract"
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
DEPLOYMENT_TRANSACTION_FILE="$STATE_DIR/deployment-phase.env"
PRODUCTION_HOST_CONTRACT_REPORT_FILE="$STATE_DIR/rollback-host-contract.json"
DEPLOYMENT_STATE_USE_VERIFIER=1
ROLLBACK_READINESS_USE_VERIFIER=1
export DEPLOYMENT_TRANSACTION_FILE PRODUCTION_HOST_CONTRACT_REPORT_FILE DEPLOYMENT_STATE_USE_VERIFIER
export ROLLBACK_READINESS_USE_VERIFIER
deployment_state_init_paths "$STATE_DIR"

# The v2 path delegates to the stable rollback executor and
# scripts/lib/release-bundle-state.mjs. It is the authoritative rollback
# source; the legacy snapshot remains only as a fail-closed migration fallback.
if deployment_state_v2_pointer_present previous; then
  if ! production_host_contract_validate \
    "$CLASSROOMPATH_DEPLOY_ROOT" \
    "${PRODUCTION_HOST_DISK_THRESHOLD_PERCENT:-80}" \
    "$PRODUCTION_HOST_CONTRACT_REPORT_FILE"; then
    exit 1
  fi
  if [ -f "$DEPLOYMENT_TRANSACTION_FILE" ]; then
    set -a
    # shellcheck disable=SC1090 # bounded transaction marker written atomically
    . "$DEPLOYMENT_TRANSACTION_FILE"
    set +a
  else
    deployment_transaction_init "$DEPLOYMENT_TRANSACTION_FILE" "" "" || exit 1
  fi
  if ! rollback_executor_preflight; then
    log_error "Previous production Release Bundle v2 state could not be verified"
    exit 1
  fi
  ROLLBACK_USES_V2=1
else
  ROLLBACK_USES_V2=0
  if ! release_state_require_snapshot_fields "$DEPLOYMENT_STATE_PREVIOUS_FILE" current-runtime; then
    log_error "Previous production release snapshot is incompatible with the current runtime contract"
    exit 1
  fi

  PREVIOUS_IMAGE_SOURCE="$(release_state_snapshot_value "$DEPLOYMENT_STATE_PREVIOUS_FILE" IMAGE_SOURCE)" || {
    log_error "Previous production release snapshot does not declare IMAGE_SOURCE"
    exit 1
  }
  if [ "$PREVIOUS_IMAGE_SOURCE" != "release-candidate" ]; then
    log_error "Production rollback supports only release-candidate snapshots (IMAGE_SOURCE=$PREVIOUS_IMAGE_SOURCE)"
    exit 1
  fi

  deployment_state_load_previous_release
fi

if [ "${ROLLBACK_USES_V2:-0}" = "1" ] && [ "${MUTATION_BOUNDARY_REACHED:-0}" != "1" ]; then
  log_info "Production deploy failed before the mutation boundary; no rollback is required"
  exit 0
fi

if [ -z "${APP_SHA:-}" ] || [ -z "${IMAGE_SOURCE:-}" ] || [ -z "${RELEASE_ID:-}" ] || [ -z "${RC_RUN_ID:-}" ] || [ -z "${OPENPATH_SHA:-}" ] || [ -z "${OPENPATH_CONTRACT_SHA256:-}" ] || [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" ] || [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}" ] || [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}" ]; then
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
  *)
    log_error "Production rollback supports only release-candidate snapshots (IMAGE_SOURCE=$IMAGE_SOURCE)"
    exit 1
    ;;
esac

# Evaluate this before checkout or Docker mutation. An old ClassroomPath
# release without the canonical OpenPath installer pins is not eligible for
# automatic rollback, including after legacy DB/storage retirement.
require_openpath_linux_agent_runtime_pin || exit 1
require_windows_offline_installer_runtime_pin || exit 1

ROLLBACK_RELEASE_APP_SHA="$APP_SHA"
ROLLBACK_RELEASE_IMAGE_SOURCE="${IMAGE_SOURCE:-}"
ROLLBACK_RELEASE_ID="${RELEASE_ID:-}"
ROLLBACK_RELEASE_RC_RUN_ID="${RC_RUN_ID:-}"
ROLLBACK_OPENPATH_SHA="${OPENPATH_SHA:-}"
ROLLBACK_OPENPATH_CONTRACT_SHA256="${OPENPATH_CONTRACT_SHA256:-}"
ROLLBACK_RELEASE_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}"
deployment_state_load_context
APP_SHA="$ROLLBACK_RELEASE_APP_SHA"
IMAGE_SOURCE="$ROLLBACK_RELEASE_IMAGE_SOURCE"
RELEASE_ID="$ROLLBACK_RELEASE_ID"
RC_RUN_ID="$ROLLBACK_RELEASE_RC_RUN_ID"
OPENPATH_SHA="$ROLLBACK_OPENPATH_SHA"
OPENPATH_CONTRACT_SHA256="$ROLLBACK_OPENPATH_CONTRACT_SHA256"
CLASSROOMPATH_VERIFIER_IMAGE="$ROLLBACK_RELEASE_VERIFIER_IMAGE"

if [ -n "${MIGRATION_RISK_LEVEL:-}" ] || [ -n "${DB_MIGRATED:-}" ] || [ -n "${PRODUCTION_BACKUP_REFERENCE:-}" ]; then
  log_warn "Rollback context: migration risk=${MIGRATION_RISK_LEVEL:-unknown}, db_migrated=${DB_MIGRATED:-unknown}, backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
fi

cd "$APP_DIR"
if ! git cat-file -e "$APP_SHA^{commit}"; then
  log_error "Previous production release commit is not present locally; refusing remote re-resolution"
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
checked_out_openpath_sha="$(git rev-parse HEAD:upstream/openpath)"
if [ "$checked_out_openpath_sha" != "$OPENPATH_SHA" ]; then
  log_error "Checked-out OpenPath gitlink $checked_out_openpath_sha does not match Release Bundle OpenPath SHA $OPENPATH_SHA"
  exit 1
fi
# Do not refresh helpers from the checked-out candidate/previous tree here.
# The stable rollback executor and the verifier selected from the durable
# previous bundle remain authoritative across the whole recovery operation.
if ! require_windows_offline_installer_runtime_pin; then
  log_error "Previous production release does not meet the canonical installer contract"
  exit 1
fi

if [ "${ROLLBACK_USES_V2:-0}" = "1" ]; then
  if ! rollback_executor_begin; then
    log_error "Unable to mark the rollback transaction as ROLLING_BACK"
    exit 1
  fi
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
if ! upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"; then
  log_error "Unable to restore OPENPATH_LINUX_AGENT_APT_SUITE for production rollback"
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
  if [ "${ROLLBACK_USES_V2:-0}" = "1" ]; then
    rollback_executor_mark_failure "READINESS" "rollback-readiness" "rollback-execution" \
      "previous release failed health or readiness" || true
  fi
  exit 1
fi

if ! deployment_state_activate_previous_release; then
  log_error "Rollback passed health/readiness, but the previous release state could not be activated"
  if [ "${ROLLBACK_USES_V2:-0}" = "1" ]; then
    rollback_executor_mark_failure "ACTIVATION" "rollback-activation" "rollback-execution" \
      "previous release state activation failed" || true
  fi
  exit 1
fi

if [ "${ROLLBACK_USES_V2:-0}" = "1" ]; then
  if ! rollback_executor_mark_success; then
    log_error "Rollback activated the previous release but could not persist ROLLED_BACK"
    exit 1
  fi
fi

log_success "Rollback health and readiness checks passed"
exit 0
