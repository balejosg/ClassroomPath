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

# Streamed deploys must still bootstrap cleanly against hosts that have not yet
# checked out the latest scaffold helper contract.
: "${COMMON_SH_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/common.sh")}"
: "${DEPLOY_HOST_PREFLIGHT_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-host-preflight.sh")}"
: "${RELEASE_MANIFEST_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")}"
: "${DEPLOY_PAYLOAD_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-payload.sh")}"
: "${RELEASE_STATE_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")}"
: "${RELEASE_RUNTIME_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")}"
: "${RELEASE_EXECUTION_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-execution.sh")}"
: "${REMOTE_HELPER_CONTRACTS_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-helper-contracts.sh")}"
: "${DEPLOYMENT_STATE_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-state.sh")}"
: "${DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-production-context.sh")}"
: "${DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-production-runtime.sh")}"
: "${DEPLOY_CONTAINER_PLATFORM_HELPER_PATH:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-container-platform.sh")}"

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

if release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then
  # shellcheck source=lib/release-manifest.sh
  source "$RELEASE_MANIFEST_HELPER_PATH"
else
  log_error "Remote release-manifest helper does not meet the minimum contract"
  exit 1
fi

if [ ! -f "$DEPLOY_PAYLOAD_HELPER_PATH" ]; then
  decode_deploy_payload_base64() {
    local payload_b64="$1"
    local target_path="${2:-$(mktemp)}"

    if [ -z "$payload_b64" ]; then
      log_error "Deploy payload is empty"
      return 1
    fi

    printf '%s' "$payload_b64" | base64 --decode > "$target_path"
    printf '%s\n' "$target_path"
  }

  deploy_payload_get() {
    local payload_path="$1"
    local key="$2"

    awk -v key="$key" '
      index($0, key "=") == 1 {
        print substr($0, length(key) + 2)
        found = 1
        exit
      }
      END {
        if (!found) {
          exit 1
        }
      }
    ' "$payload_path"
  }
else
  # shellcheck source=lib/deploy-payload.sh
  source "$DEPLOY_PAYLOAD_HELPER_PATH"
fi

if release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
else
  log_error "Remote release-state helper does not meet the minimum runtime contract"
  exit 1
fi

if deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
  # shellcheck source=lib/deployment-state.sh
  source "$DEPLOYMENT_STATE_HELPER_PATH"
else
  log_error "Remote deployment-state helper does not meet the minimum contract"
  exit 1
fi

if release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
  # shellcheck source=lib/release-runtime.sh
  source "$RELEASE_RUNTIME_HELPER_PATH"
else
  log_error "Remote release-runtime helper does not meet the minimum contract"
  exit 1
fi

log_info "Starting ClassroomPath Docker deployment..."

DEPLOY_DIR="$CLASSROOMPATH_DEPLOY_ROOT"
STATE_DIR="$DEPLOY_DIR/release-state"
DEPLOY_CONTEXT_FILE="$STATE_DIR/deploy-context.env"
mkdir -p "$STATE_DIR"
deployment_state_init_paths "$STATE_DIR"

DB_MIGRATED=0
FAILURE_STAGE="preflight"
DEPLOY_FAILURE_STAGE="preflight"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
PRODUCTION_BACKUP_REFERENCE=""
RELEASE_MANIFEST_FILE=""
RELEASE_BUNDLE_FILE=""
OPENPATH_CONTRACT_FILE=""
RELEASE_BUNDLE_RUNTIME_FILE=""
DEPLOY_PAYLOAD_FILE=""
RELEASE_MANIFEST_B64_FROM_PAYLOAD=""
DEPLOY_RELEASE_ID=""
DEPLOY_RC_RUN_ID=""
DEPLOY_RELEASE_BUNDLE_B64=""
DEPLOY_OPENPATH_CONTRACT_B64=""
DEPLOY_PAYLOAD_TARGET_SHA=""
TARGET_SHA=""
PRODUCTION_REGISTRY_LOGGED_IN=0
DEPLOY_DEBUG_FILE="$STATE_DIR/deploy-debug.json"

cleanup_production_deploy_artifacts() {
  local exit_status="$?"

  if [ "$exit_status" -ne 0 ] && declare -f write_production_deploy_debug_context >/dev/null 2>&1; then
    write_production_deploy_debug_context "$exit_status" || true
  fi

  rm -f \
    "${RELEASE_MANIFEST_FILE:-}" \
    "${RELEASE_BUNDLE_FILE:-}" \
    "${OPENPATH_CONTRACT_FILE:-}" \
    "${RELEASE_BUNDLE_RUNTIME_FILE:-}" \
    "${DEPLOY_PAYLOAD_FILE:-}"
  if [ "${PRODUCTION_REGISTRY_LOGGED_IN:-0}" = "1" ]; then
    docker logout ghcr.io >/dev/null 2>&1 || true
  fi
}

trap cleanup_production_deploy_artifacts EXIT

json_escape() {
  printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g'
}

command_status_json() {
  local command_name="$1"
  local status="missing"

  if command -v "$command_name" >/dev/null 2>&1; then
    status="available"
  fi

  printf '"%s":"%s"' "$(json_escape "$command_name")" "$status"
}

helper_contract_status_json() {
  local helper_name="$1"
  local helper_path="$2"
  local contract_status="missing"

  if [ -f "$helper_path" ]; then
    contract_status="present"
  fi

  printf '"%s":{"path":"%s","status":"%s"}' \
    "$(json_escape "$helper_name")" \
    "$(json_escape "$helper_path")" \
    "$contract_status"
}

write_production_deploy_debug_context() {
  local failed_status="${1:-1}"
  local tmp_file=""

  mkdir -p "$STATE_DIR"
  tmp_file="$(mktemp)"

  {
    printf '{\n'
    printf '  "deployStage":"%s",\n' "$(json_escape "${DEPLOY_FAILURE_STAGE:-${FAILURE_STAGE:-preflight}}")"
    printf '  "targetSha":"%s",\n' "$(json_escape "${TARGET_SHA:-${DEPLOY_SHA:-unknown}}")"
    printf '  "deployRoot":"%s",\n' "$(json_escape "$DEPLOY_DIR")"
    printf '  "containerPlatform":"%s",\n' "$(json_escape "${CLASSROOMPATH_CONTAINER_PLATFORM:-${PRODUCTION_CONTAINER_PLATFORM:-unknown}}")"
    printf '  "lastFailingPhase":"%s",\n' "$(json_escape "${FAILURE_STAGE:-${DEPLOY_FAILURE_STAGE:-preflight}}")"
    printf '  "exitStatus":%s,\n' "$failed_status"
    printf '  "helperContracts":{'
    helper_contract_status_json "remoteBootstrap" "$REMOTE_BOOTSTRAP_HELPER_PATH"
    printf ','
    helper_contract_status_json "remoteHelperContracts" "$REMOTE_HELPER_CONTRACTS_PATH"
    printf ','
    helper_contract_status_json "releaseManifest" "$RELEASE_MANIFEST_HELPER_PATH"
    printf ','
    helper_contract_status_json "releaseState" "$RELEASE_STATE_HELPER_PATH"
    printf ','
    helper_contract_status_json "releaseRuntime" "$RELEASE_RUNTIME_HELPER_PATH"
    printf ','
    helper_contract_status_json "deploymentState" "$DEPLOYMENT_STATE_HELPER_PATH"
    printf ','
    helper_contract_status_json "releaseExecution" "$RELEASE_EXECUTION_HELPER_PATH"
    printf '},\n'
    printf '  "commands":{'
    command_status_json bash
    printf ','
    command_status_json git
    printf ','
    command_status_json docker
    printf ','
    command_status_json node
    printf '}\n'
    printf '}\n'
  } > "$tmp_file"

  install -m 600 "$tmp_file" "$DEPLOY_DEBUG_FILE"
  rm -f "$tmp_file"
  printf 'Production deploy debug context written to %s\n' "$DEPLOY_DEBUG_FILE" >&2
}

capture_production_deploy_failure() {
  local failed_status="$?"

  trap - ERR
  write_production_deploy_debug_context "$failed_status" || true
  return "$failed_status"
}

trap capture_production_deploy_failure ERR

login_production_registry() {
  if [ "${PRODUCTION_REGISTRY_LOGGED_IN:-0}" = "1" ]; then
    return 0
  fi

  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
  PRODUCTION_REGISTRY_LOGGED_IN=1
}

cleanup_production_disk_if_needed() {
  cleanup_docker_disk_if_needed "Production host"
}

load_deploy_host_preflight_helper() {
  DEPLOY_HOST_PREFLIGHT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-host-preflight.sh")"

  if [ ! -f "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH" ]; then
    printf 'Deploy host preflight helper not found after checkout: %s\n' "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH" >&2
    exit 1
  fi

  # shellcheck source=lib/deploy-host-preflight.sh
  source "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH"
}

load_deploy_container_platform_helper() {
  DEPLOY_CONTAINER_PLATFORM_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-container-platform.sh")"

  if [ ! -f "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH" ]; then
    printf 'Deploy container platform helper not found after checkout: %s\n' "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH" >&2
    exit 1
  fi

  # shellcheck source=lib/deploy-container-platform.sh
  source "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH"
}

load_production_deploy_payload() {
  local release_manifest_b64=""
  local release_bundle_b64=""
  local openpath_contract_b64=""
  local payload_image_source=""
  local payload_deployment_mode=""

  if [ -n "${DEPLOY_PAYLOAD_B64:-}" ]; then
    DEPLOY_PAYLOAD_FILE="$(mktemp)"
    decode_deploy_payload_base64 "$DEPLOY_PAYLOAD_B64" "$DEPLOY_PAYLOAD_FILE" >/dev/null
    DEPLOY_PAYLOAD_TARGET_SHA="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" deploy_sha)"
    TARGET_SHA="$DEPLOY_PAYLOAD_TARGET_SHA"
    payload_image_source="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" image_source)"
    payload_deployment_mode="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" deployment_mode)"
    release_manifest_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" manifest_base64)"
    DEPLOY_RELEASE_ID="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" release_id || true)"
    DEPLOY_RC_RUN_ID="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" rc_run_id || true)"
    release_bundle_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" release_bundle_base64 || true)"
    openpath_contract_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" openpath_contract_base64 || true)"
    if [ "$payload_image_source" != "release-candidate" ]; then
      log_error "Production deploy payload must resolve immutable release-candidate images"
      exit 1
    fi
    if [ "$payload_deployment_mode" != "promotion-eligible" ]; then
      log_error "Production deploy payload must come from a promotion-eligible staging release"
      exit 1
    fi
    RELEASE_MANIFEST_B64_FROM_PAYLOAD="$release_manifest_b64"
    DEPLOY_RELEASE_BUNDLE_B64="$release_bundle_b64"
    DEPLOY_OPENPATH_CONTRACT_B64="$openpath_contract_b64"
    if [ -z "$DEPLOY_RELEASE_ID" ] || [ -z "$DEPLOY_RC_RUN_ID" ] || [ -z "$DEPLOY_RELEASE_BUNDLE_B64" ] || [ -z "$DEPLOY_OPENPATH_CONTRACT_B64" ]; then
      log_error "Production deploy payload must contain one exact Release Bundle v2, contract, releaseId, and RC run ID"
      exit 1
    fi
    if ! [[ "$DEPLOY_RC_RUN_ID" =~ ^[0-9]+$ ]]; then
      log_error "Production deploy payload RC run ID must be numeric"
      exit 1
    fi
  else
    log_error "Production deployment requires an exact Release Bundle v2 deploy payload"
    exit 1
  fi
}

prepare_production_checkout() {
  cd "$APP_DIR"

  log_info "Pulling latest changes..."
  git fetch origin --tags --prune
  git fetch origin main --prune
  git checkout -- . 2>/dev/null || true
  git clean -fd 2>/dev/null || true

  if [[ "${DEPLOY_REF:-}" == refs/tags/* ]]; then
    local tag_name="${DEPLOY_REF#refs/tags/}"
    TARGET_SHA=$(git rev-parse "${tag_name}^{commit}" 2>/dev/null || true)
    if [ -z "$TARGET_SHA" ]; then
      git fetch origin "refs/tags/${tag_name}:refs/tags/${tag_name}" || true
      TARGET_SHA=$(git rev-parse "${tag_name}^{commit}" 2>/dev/null || true)
    fi
    if [ -n "${DEPLOY_PAYLOAD_TARGET_SHA:-}" ] && [ "$TARGET_SHA" != "$DEPLOY_PAYLOAD_TARGET_SHA" ]; then
      die "Production tag target $TARGET_SHA does not match deploy payload SHA $DEPLOY_PAYLOAD_TARGET_SHA" 1
    fi
  fi

  if [ -z "$TARGET_SHA" ] && [ -n "${DEPLOY_SHA:-}" ]; then
    TARGET_SHA=$(git rev-parse "${DEPLOY_SHA}^{commit}" 2>/dev/null || true)
  fi

  if [ -z "$TARGET_SHA" ]; then
    TARGET_SHA=$(git rev-parse origin/main)
  fi

  log_info "Deploying ClassroomPath commit: $TARGET_SHA"

  git checkout --detach "$TARGET_SHA"
  git reset --hard "$TARGET_SHA"
  git submodule deinit -f --all || true
  git submodule update --init --recursive --force
  remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"
  deployment_state_init_paths "$STATE_DIR"
  RELEASE_EXECUTION_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-execution.sh")"
  if release_execution_helper_supports_contract "$RELEASE_EXECUTION_HELPER_PATH"; then
    # shellcheck source=lib/release-execution.sh
    source "$RELEASE_EXECUTION_HELPER_PATH"
  else
    log_error "Checked-out release-execution helper does not meet the minimum contract"
    exit 1
  fi
  release_execution_init_context "$DEPLOY_CONTEXT_FILE"
  load_deploy_host_preflight_helper
  load_deploy_container_platform_helper
  configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/amd64}"
  verify_deploy_container_platform
  log_info "Production checkout is now at $(git rev-parse HEAD)"

  DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-production-context.sh")"
  DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-production-runtime.sh")"

  if [ ! -f "$DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH" ] || [ ! -f "$DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH" ]; then
    die "Missing production deploy helpers after checkout" 1
  fi

  # shellcheck source=lib/deploy-production-context.sh
  source "$DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH"
  # shellcheck source=lib/deploy-production-runtime.sh
  source "$DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH"
}

load_production_release_manifest() {
  # Helper contract: load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"
  load_production_release_manifest_impl "$@"
}

classify_migration_risk_without_node() {
  release_risk_policy_classify_migration_risk_without_node "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"
}

classify_production_migration_risk() {
  deployment_state_capture_previous_release

  if command -v node >/dev/null 2>&1; then
    release_execution_classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"
  else
    classify_migration_risk_without_node
  fi

  if [ "${MIGRATION_RISK_LEVEL:-safe}" = "destructive" ]; then
    log_warn "Destructive migration risk detected: ${MIGRATION_DESTRUCTIVE_FILES:-unknown files}"
  fi

  release_execution_require_production_backup
  release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
}

run_production_database_migrations() {
  release_execution_mark_stage migrations

  cleanup_production_disk_if_needed
  login_production_registry

  log_info "Checking transactional email delivery..."
  CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA="${CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA:-0}" \
    CP_EMAIL_PREFLIGHT_MODE="${CP_EMAIL_PREFLIGHT_MODE:-required}" \
    CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}" \
    bash scripts/check-email-delivery-docker.sh

  log_info "Running database migrations from the release candidate runner..."
  bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"

  DB_MIGRATED=1
  release_execution_mark_stage startup
}

plan_production_runtime_deploy() {
  plan_production_runtime_deploy_impl "$@"
}

apply_production_runtime_deploy() {
  # Helper contract: write_release_runtime_state "$STATE_DIR/current-images.env"
  apply_production_runtime_deploy_impl "$@"
}

start_production_runtime() {
  start_production_runtime_impl "$@"
}

wait_for_production_runtime_readiness() {
  wait_for_production_runtime_readiness_impl "$@"
}


run_remote_deploy_phases \
  load_production_deploy_payload \
  prepare_production_checkout \
  load_production_release_manifest \
  classify_production_migration_risk \
  cleanup_production_disk_if_needed \
  run_production_database_migrations \
  start_production_runtime \
  wait_for_production_runtime_readiness
