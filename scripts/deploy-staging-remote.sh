#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/srv/classroompath/app"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
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

if release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
  # shellcheck source=lib/release-runtime.sh
  source "$RELEASE_RUNTIME_HELPER_PATH"
else
  log_error "Remote release-runtime helper does not meet the minimum contract"
  exit 1
fi

STATE_DIR="/srv/classroompath/release-state"
CURRENT_STATE_FILE="$STATE_DIR/current-images.env"
PREVIOUS_STATE_FILE="$STATE_DIR/previous-images.env"
DEPLOY_CONTEXT_FILE="$STATE_DIR/staging-deploy-context.env"
mkdir -p "$STATE_DIR"

IMAGE_SOURCE="source-build"
RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
RESOLVED_OPENPATH_FIREFOX_ASSETS_IMAGE=""
RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
RESOLVED_OPENPATH_VERSION=""
RESOLVED_OPENPATH_LINUX_AGENT_VERSION=""
RESOLVED_SPA_IMAGE="classroompath-spa:local"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
DB_MIGRATED=0
FAILURE_STAGE="preflight"
ROLLBACK_ATTEMPTED=0
ROLLBACK_RESULT="not_attempted"
STAGING_DEPLOY_PAYLOAD_FILE=""
STAGING_RELEASE_MANIFEST_FILE=""

cleanup_staging_release_manifest() {
  rm -f "${STAGING_RELEASE_MANIFEST_FILE:-}" "${STAGING_DEPLOY_PAYLOAD_FILE:-}"
}

trap cleanup_staging_release_manifest EXIT

copy_release_state() {
  if [ -f "$CURRENT_STATE_FILE" ]; then
    cp "$CURRENT_STATE_FILE" "$PREVIOUS_STATE_FILE"
    PREVIOUS_APP_SHA="$(grep '^APP_SHA=' "$CURRENT_STATE_FILE" | cut -d= -f2- || true)"
  fi
}

write_release_state() {
  copy_release_state
  write_release_runtime_state \
    "$CURRENT_STATE_FILE" \
    "${STAGING_RELEASE_SHA:-origin-main}" \
    "$IMAGE_SOURCE" \
    "$RESOLVED_GATEWAY_IMAGE" \
    "$RESOLVED_MIGRATIONS_IMAGE" \
    "${RESOLVED_OPENPATH_FIREFOX_ASSETS_IMAGE:-}" \
    "$RESOLVED_OPENPATH_API_IMAGE" \
    "$RESOLVED_OPENPATH_VERSION" \
    "$RESOLVED_OPENPATH_LINUX_AGENT_VERSION" \
    "$RESOLVED_SPA_IMAGE"
}

write_deploy_context() {
  APP_SHA="${STAGING_RELEASE_SHA:-origin-main}" \
    release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
}

resolve_pulled_digest() {
  local image_ref="$1"
  local repo_digest=""
  repo_digest="$(docker image inspect "$image_ref" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  if [ -n "$repo_digest" ]; then
    printf '%s' "$repo_digest"
    return
  fi

  printf '%s' "$image_ref"
}

classify_migration_risk() {
  release_execution_classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "${STAGING_RELEASE_SHA:-origin/main}"
}

restore_previous_release_state() {
  if [ ! -f "$PREVIOUS_STATE_FILE" ]; then
    log_warn "No previous release metadata available; cannot restore previous release"
    ROLLBACK_RESULT="unavailable"
    write_deploy_context
    return 1
  fi

  log_warn "Attempting to restore previous staging release state..."
  ROLLBACK_ATTEMPTED=1
  write_deploy_context

  set -a
  . "$PREVIOUS_STATE_FILE"
  set +a

  git checkout --detach "$APP_SHA"
  git reset --hard "$APP_SHA"
  git submodule sync --recursive
  git submodule update --init --recursive --force

  cd "$APP_DIR/docker"
  export COMPOSE_PROJECT_NAME=classroompath-staging

  if [ "${IMAGE_SOURCE:-source-build}" = "release-candidate" ]; then
    export CLASSROOMPATH_GATEWAY_IMAGE
    export CLASSROOMPATH_MIGRATIONS_IMAGE
    export OPENPATH_API_IMAGE
    export CLASSROOMPATH_SPA_IMAGE
    upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"
    upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"
    upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"
    docker compose pull gateway api spa
    compose_up_force_recreate_no_build
  else
    remove_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION
    remove_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION
    remove_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE
    unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE
    docker compose build
    docker compose up -d --force-recreate
  fi

  cp "$PREVIOUS_STATE_FILE" "$CURRENT_STATE_FILE"
  ROLLBACK_RESULT="success"
  write_deploy_context
  return 0
}

fail_after_migrations() {
  local message="$1"
  log_error "$message"
  if release_execution_staging_restore_is_eligible && restore_previous_release_state; then
    log_warn "Previous staging release restored after failure"
  elif ! release_execution_staging_restore_is_eligible; then
    log_warn "Previous staging release restore is not eligible at stage ${FAILURE_STAGE:-unknown}"
  else
    log_error "Failed to restore previous staging release"
  fi
  exit 1
}

compose_up_force_recreate_no_build() {
  local compose_output=""
  local compose_exit_code=0

  set +e
  compose_output="$(docker compose up -d --force-recreate --no-build 2>&1)"
  compose_exit_code=$?
  set -e

  if [ "$compose_exit_code" -eq 0 ]; then
    printf '%s\n' "$compose_output"
    return 0
  fi

  printf '%s\n' "$compose_output" >&2

  if printf '%s\n' "$compose_output" | grep -q "No such container"; then
    log_warn "docker compose reported a stale container reference; retrying once after cleanup..."
    docker compose down --remove-orphans 2>/dev/null || true
    docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
    docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
    docker compose up -d --force-recreate --no-build
    return $?
  fi

  return $compose_exit_code
}

login_staging_release_candidate_registry() {
  login_staging_registry
}

deploy_with_release_candidates() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 1
  fi

  ensure_staging_release_candidate_runtime_env || return 1

  if [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" ] || [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ]; then
    log_error "Release candidate manifest is incomplete"
    return 1
  fi

  login_staging_registry || return 1

  export COMPOSE_PROJECT_NAME=classroompath-staging
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release

  log_info "Pulling release candidate migrations image for ${STAGING_RELEASE_SHA:-origin-main}..."
  docker pull "$CLASSROOMPATH_MIGRATIONS_IMAGE" || return 1

  log_info "Preparing OpenPath Firefox release assets for ${STAGING_RELEASE_SHA:-origin-main}..."
  prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "${STAGING_RELEASE_SHA:-origin-main}" || return 1

  log_info "Pulling release candidate images for ${STAGING_RELEASE_SHA:-origin-main}..."
  docker compose pull gateway api spa || return 1

  log_info "Starting staging from release candidate images..."
  docker compose down --remove-orphans 2>/dev/null || true
  docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  compose_up_force_recreate_no_build || return 1

  IMAGE_SOURCE="release-candidate"
  RESOLVED_GATEWAY_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_GATEWAY_IMAGE")"
  RESOLVED_MIGRATIONS_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_MIGRATIONS_IMAGE")"
  RESOLVED_OPENPATH_FIREFOX_ASSETS_IMAGE="$(resolve_pulled_digest "$OPENPATH_FIREFOX_ASSETS_IMAGE")"
  RESOLVED_OPENPATH_API_IMAGE="$(resolve_pulled_digest "$OPENPATH_API_IMAGE")"
  RESOLVED_OPENPATH_VERSION="${OPENPATH_VERSION:-}"
  RESOLVED_OPENPATH_LINUX_AGENT_VERSION="${OPENPATH_LINUX_AGENT_VERSION:-}"
  RESOLVED_SPA_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_SPA_IMAGE")"
  write_release_state
  return 0
}

ensure_staging_release_candidate_runtime_env() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 0
  fi

  if [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ]; then
    if [ -n "${STAGING_RELEASE_MANIFEST_FILE:-}" ] && [ -f "$STAGING_RELEASE_MANIFEST_FILE" ]; then
      load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE" "${STAGING_RELEASE_SHA:-}"
      STAGING_RELEASE_SHA="${RELEASE_MANIFEST_APP_SHA:-${STAGING_RELEASE_SHA:-}}"
    fi
  fi

  if [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ]; then
    log_error "Release candidate manifest did not export OpenPath runtime versions"
    return 1
  fi

  return 0
}

deploy_from_source() {
  log_info "Rebuilding containers from source..."
  export COMPOSE_PROJECT_NAME=classroompath-staging
  unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE
  remove_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION
  remove_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION
  remove_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE
  RESOLVED_OPENPATH_VERSION=""
  RESOLVED_OPENPATH_LINUX_AGENT_VERSION=""

  docker compose down --remove-orphans 2>/dev/null || true
  docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true

  if ! docker compose build --quiet; then
    log_warn "Build failed in quiet mode; retrying with verbose output..."
    docker compose build || return 1
  fi

  docker compose up -d --force-recreate || return 1
  IMAGE_SOURCE="source-build"
  RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
  RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
  RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
  RESOLVED_SPA_IMAGE="classroompath-spa:local"
  write_release_state
  return 0
}

load_staging_release_manifest() {
  local release_manifest_b64=""
  local normalized_manifest_file=""
  local payload_image_source=""
  local payload_deployment_mode=""

  if [ -n "${STAGING_DEPLOY_PAYLOAD_B64:-}" ]; then
    STAGING_DEPLOY_PAYLOAD_FILE="$(mktemp)"
    decode_deploy_payload_base64 "$STAGING_DEPLOY_PAYLOAD_B64" "$STAGING_DEPLOY_PAYLOAD_FILE" >/dev/null
    payload_image_source="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" image_source)"
    payload_deployment_mode="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" deployment_mode)"
    STAGING_IMAGE_SOURCE="${payload_image_source:-${STAGING_IMAGE_SOURCE:-source-build}}"
    STAGING_DEPLOYMENT_MODE="${payload_deployment_mode:-${STAGING_DEPLOYMENT_MODE:-debug}}"
    if [ "$STAGING_IMAGE_SOURCE" = "release-candidate" ]; then
      STAGING_USE_RELEASE_CANDIDATE=1
    else
      STAGING_USE_RELEASE_CANDIDATE=0
    fi
  fi

  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 0
  fi

  if [ -n "${STAGING_DEPLOY_PAYLOAD_FILE:-}" ] && [ -f "$STAGING_DEPLOY_PAYLOAD_FILE" ]; then
    release_manifest_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" manifest_base64)"
  else
    release_manifest_b64="$STAGING_RELEASE_MANIFEST_B64"
  fi

  STAGING_RELEASE_MANIFEST_FILE="$(mktemp)"
  decode_release_manifest_base64 "$STAGING_RELEASE_MANIFEST_B64" "$STAGING_RELEASE_MANIFEST_FILE" >/dev/null || true
  decode_release_manifest_base64 "$release_manifest_b64" "$STAGING_RELEASE_MANIFEST_FILE" >/dev/null
  normalized_manifest_file="$(mktemp)"
  node "$APP_DIR/scripts/lib/release-manifest.mjs" normalize \
    --file "$STAGING_RELEASE_MANIFEST_FILE" \
    --output-file "$normalized_manifest_file" \
    --sha "${STAGING_RELEASE_SHA:-}" \
    --repository "${STAGING_RELEASE_REPOSITORY:-}" \
    --run-id "${STAGING_RELEASE_RUN_ID:-}"
  mv "$normalized_manifest_file" "$STAGING_RELEASE_MANIFEST_FILE"
  load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"

  STAGING_RELEASE_SHA="$RELEASE_MANIFEST_APP_SHA"
}

login_staging_registry() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 0
  fi

  if [ "${STAGING_REGISTRY_LOGIN_DONE:-0}" = "1" ]; then
    return 0
  fi

  if [ -n "${STAGING_GHCR_TOKEN:-}" ]; then
    if [ -z "${STAGING_GHCR_USERNAME:-}" ]; then
      log_error "STAGING_GHCR_TOKEN is set but STAGING_GHCR_USERNAME is missing"
      return 1
    fi

    echo "$STAGING_GHCR_TOKEN" | docker login ghcr.io -u "$STAGING_GHCR_USERNAME" --password-stdin
  fi

  STAGING_REGISTRY_LOGIN_DONE=1
}

preflight_staging_release_candidate_image() {
  local label="$1"
  local image_ref="$2"
  local pull_log=""

  if [ -z "$image_ref" ]; then
    log_error "GHCR preflight missing ${label} image ref"
    return 1
  fi

  pull_log="$(mktemp)"
  log_info "Preflighting ${label} image from GHCR: ${image_ref}"
  if docker pull "$image_ref" >"$pull_log" 2>&1; then
    rm -f "$pull_log"
    return 0
  fi

  log_error "GHCR preflight failed for ${label} image: ${image_ref}"
  if grep -qiE 'denied|unauthorized|forbidden|manifest unknown|not found|digest|failed to resolve' "$pull_log"; then
    log_error "Registry access or digest resolution failed for ${label} image: ${image_ref}"
  fi
  cat "$pull_log" >&2
  rm -f "$pull_log"
  return 1
}

preflight_staging_release_candidate_images() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 0
  fi

  ensure_staging_release_candidate_runtime_env || return 1

  preflight_staging_release_candidate_image "verifier" "$CLASSROOMPATH_VERIFIER_IMAGE" || return 1
  preflight_staging_release_candidate_image "migrations" "$CLASSROOMPATH_MIGRATIONS_IMAGE" || return 1
  preflight_staging_release_candidate_image "gateway" "$CLASSROOMPATH_GATEWAY_IMAGE" || return 1
  preflight_staging_release_candidate_image "OpenPath API" "$OPENPATH_API_IMAGE" || return 1
  preflight_staging_release_candidate_image "SPA" "$CLASSROOMPATH_SPA_IMAGE" || return 1
  preflight_staging_release_candidate_image "OpenPath Firefox assets" "$OPENPATH_FIREFOX_ASSETS_IMAGE" || return 1
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

prepare_staging_checkout() {
  cd "$APP_DIR"

  log_info "Fetching latest from origin..."
  git fetch origin main

  log_info "Resetting to origin/main..."
  git reset --hard origin/main

  log_info "Updating submodules..."
  git submodule sync --recursive
  git submodule update --init --recursive --force
  remote_deploy_reload_checked_out_helpers "$APP_DIR/scripts/lib/common.sh"
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
  configure_deploy_container_platform "${STAGING_CONTAINER_PLATFORM:-linux/amd64}"
  verify_deploy_container_platform
  log_info "Staging checkout is now at $(git rev-parse HEAD)"

  load_staging_release_manifest
  login_staging_registry
  preflight_staging_release_candidate_images
  classify_migration_risk
  release_execution_mark_stage preflight
}

run_staging_runtime_validation() {
  local staging_public_url="${STAGING_PUBLIC_URL:-}"
  local staging_canary_public_url="${STAGING_CANARY_PUBLIC_URL:-}"

  if [ -z "$staging_public_url" ]; then
    staging_public_url="$(node "$APP_DIR/scripts/deploy-targets.mjs" get staging publicUrl)"
  fi
  if [ -z "$staging_canary_public_url" ]; then
    staging_canary_public_url="$(node "$APP_DIR/scripts/deploy-targets.mjs" get staging canaryPublicUrl 2>/dev/null || printf '%s' "$staging_public_url")"
  fi

  staging_public_url="${staging_public_url%/}"
  staging_canary_public_url="${staging_canary_public_url%/}"
  export OPENPATH_FIREFOX_EXTENSION_INSTALL_URL="$staging_canary_public_url/api/extensions/firefox/openpath.xpi"

  log_info "Syncing staging public runtime env..."
  upsert_env_file_var "$APP_DIR/config/.env" PUBLIC_URL "$staging_public_url"
  upsert_env_file_var "$APP_DIR/config/.env" CORS_ORIGINS "$staging_public_url"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_EXTENSION_INSTALL_URL "$OPENPATH_FIREFOX_EXTENSION_INSTALL_URL"

  log_info "Syncing billing runtime env..."
  bash scripts/sync-billing-env.sh "$APP_DIR/config/.env"

  log_info "Validating runtime config..."
  CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}" bash scripts/validate-runtime-config-docker.sh
}

run_staging_email_delivery_preflight() {
  log_info "Checking transactional email delivery..."
  CP_EMAIL_PREFLIGHT_MODE="${CP_EMAIL_PREFLIGHT_MODE:-required}" \
    CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}" \
    bash scripts/check-email-delivery-docker.sh
}

run_staging_preflight_checks() {
  run_remote_deploy_phase_group staging-preflight provision_windows_offline_installer_template run_staging_runtime_validation run_staging_email_delivery_preflight
}

cleanup_staging_disk_if_needed() {
  cleanup_docker_disk_if_needed "Staging host"
}

run_staging_database_migrations() {
  release_execution_mark_stage migrations

  if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then
    log_info "Running database migrations from workspace sources..."
    bash scripts/run-migrations-docker.sh --cp --openpath || exit 1
  else
    if [ -z "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" ]; then
      die "Release candidate migrations image ref is missing" 1
    fi

    log_info "Running database migrations from release candidate image..."
    bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE" || exit 1
  fi

  DB_MIGRATED=1
  release_execution_mark_stage startup
}

start_staging_runtime() {
  cd "$APP_DIR/docker"

  plan_staging_runtime_deploy

  if ! apply_staging_runtime_deploy; then
    fail_after_migrations "$STAGING_DEPLOY_FAILURE_MESSAGE"
  fi
}

plan_staging_runtime_deploy() {
  if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then
    STAGING_DEPLOY_PLAN="source-build"
    STAGING_DEPLOY_FAILURE_MESSAGE="Staging source deployment failed after migrations"
    return 0
  fi

  STAGING_DEPLOY_PLAN="release-candidate"
  STAGING_DEPLOY_FAILURE_MESSAGE="Staging release-candidate deploy failed after migrations"
}

apply_staging_runtime_deploy() {
  case "${STAGING_DEPLOY_PLAN:-}" in
    source-build)
      deploy_from_source
      ;;
    release-candidate)
      deploy_with_release_candidates
      ;;
    *)
      die "Unknown staging deploy plan: ${STAGING_DEPLOY_PLAN:-unset}" 1
      ;;
  esac
}

wait_for_staging_runtime_readiness() {
  log_info "Containers started from ${IMAGE_SOURCE}, waiting for health..."

  if ! timeout 60 bash -c 'until docker compose ps | grep -q "healthy"; do sleep 2; done'; then
    docker compose ps
    fail_after_migrations "Timeout waiting for staging health checks"
  fi

  for i in 1 2 3 4 5; do
    if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
      log_success "Gateway health check passed"
      break
    fi

    if [ "$i" -eq 5 ]; then
      docker logs classroompath-gateway --tail 30
      fail_after_migrations "Gateway health checks failed after deployment"
    fi

    log_warn "Health check attempt $i failed, retrying..."
    sleep 5
  done

  release_execution_mark_stage readiness

  local ready_check=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ready_check=$(curl -sS http://localhost:3001/cp/ready 2>/dev/null || true)
    if [ -z "$ready_check" ]; then
      ready_check='{"ready":false}'
    fi

    if echo "$ready_check" | grep -q '"ready":true'; then
      log_success "Application readiness OK"
      release_execution_mark_stage completed
      return 0
    fi

    if [ "$i" -lt 12 ]; then
      log_warn "Application not ready (attempt $i/12), waiting 5s..."
      sleep 5
    else
      log_error "Readiness response: $ready_check"
      docker logs classroompath-gateway --tail 50 || true
      docker logs classroompath-api --tail 50 || true
      fail_after_migrations "Application readiness failed after staging deployment"
    fi
  done
}

run_remote_deploy_phases \
  prepare_staging_checkout \
  run_staging_preflight_checks \
  cleanup_staging_disk_if_needed \
  run_staging_database_migrations \
  start_staging_runtime \
  wait_for_staging_runtime_readiness
