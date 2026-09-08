#!/usr/bin/env bash
# shellcheck shell=bash

production_runtime_fault_barrier_error() {
  if declare -f log_error >/dev/null 2>&1; then
    log_error "$*"
  else
    printf '[ERROR] %s\n' "$*" >&2
  fi
}

production_runtime_fault_barrier_validate() {
  local ready_fifo="${K_FAULT_BARRIER_READY_FIFO:-}"
  local ack_fifo="${K_FAULT_BARRIER_ACK_FIFO:-}"
  local deploy_root_real=""
  local actual_root_sha256=""
  local expected_authorization=""
  local fifo=""
  local mode=""

  [ "${K_FAULT_MODE:-}" = staging-equivalent-gateway-stop ] || {
    production_runtime_fault_barrier_error 'K fault barrier mode is not authorized'
    return 1
  }
  [ "${K_ENVIRONMENT:-}" = staging-equivalent ] || {
    production_runtime_fault_barrier_error 'K fault barrier requires the staging-equivalent environment'
    return 1
  }
  [ "${K_RUNTIME_ENVIRONMENT:-}" = staging-equivalent ] || {
    production_runtime_fault_barrier_error 'K fault barrier runtime environment is not staging-equivalent'
    return 1
  }
  [ "${K_PRODUCTION_TARGET:-}" = false ] || {
    production_runtime_fault_barrier_error 'K fault barrier cannot run on a production target'
    return 1
  }
  [ "${K_NORMAL_STAGING_ALLOWED:-}" = false ] || {
    production_runtime_fault_barrier_error 'K fault barrier cannot run on a normal staging target'
    return 1
  }
  [ "${K_COMPOSE_PROJECT:-}" = classroompath-production ] || {
    production_runtime_fault_barrier_error 'K fault barrier Compose project is not fenced'
    return 1
  }
  [[ "${K_ENVIRONMENT_ID:-}" =~ ^[A-Za-z0-9._-]+$ ]] || {
    production_runtime_fault_barrier_error 'K fault barrier environment identity is invalid'
    return 1
  }
  [[ "${K_DEPLOY_ROOT_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || {
    production_runtime_fault_barrier_error 'K fault barrier deploy-root identity is invalid'
    return 1
  }
  [[ "${K_FAULT_TRANSACTION_ID:-}" =~ ^[0-9a-f]{64}$ ]] || {
    production_runtime_fault_barrier_error 'K fault barrier transaction identity is invalid'
    return 1
  }
  [ -n "$ready_fifo" ] && [ "$ready_fifo" != "$ack_fifo" ] || {
    production_runtime_fault_barrier_error 'K fault barrier FIFOs are incomplete or identical'
    return 1
  }
  for fifo in "$ready_fifo" "$ack_fifo"; do
    [[ "$fifo" = /* ]] || {
      production_runtime_fault_barrier_error 'K fault barrier FIFO paths must be absolute'
      return 1
    }
    [ -p "$fifo" ] && [ ! -L "$fifo" ] || {
      production_runtime_fault_barrier_error 'K fault barrier endpoints must be non-symlink FIFOs'
      return 1
    }
    mode="$(stat -c '%a' -- "$fifo" 2>/dev/null)" || {
      production_runtime_fault_barrier_error 'K fault barrier FIFO mode cannot be inspected'
      return 1
    }
    [ "$mode" = 600 ] || {
      production_runtime_fault_barrier_error 'K fault barrier FIFOs must have mode 0600'
      return 1
    }
  done
  [ -d "${CLASSROOMPATH_DEPLOY_ROOT:-}" ] || {
    production_runtime_fault_barrier_error 'K fault barrier deploy root is unavailable'
    return 1
  }
  deploy_root_real="$(cd "$CLASSROOMPATH_DEPLOY_ROOT" 2>/dev/null && pwd -P)" || {
    production_runtime_fault_barrier_error 'K fault barrier deploy root cannot be canonicalized'
    return 1
  }
  actual_root_sha256="$(printf '%s' "$deploy_root_real" | sha256sum | awk '{ print $1; exit }')" || return 1
  [ "$actual_root_sha256" = "$K_DEPLOY_ROOT_SHA256" ] || {
    production_runtime_fault_barrier_error 'K fault barrier deploy-root identity does not match'
    return 1
  }
  expected_authorization="$(printf '%s' \
    "classroompath-k-fault-v1|$K_ENVIRONMENT_ID|$K_DEPLOY_ROOT_SHA256|$K_FAULT_TRANSACTION_ID" |
    sha256sum | awk '{ print $1; exit }')" || return 1
  [ "${K_FAULT_BARRIER_AUTHORIZATION:-}" = "$expected_authorization" ] || {
    production_runtime_fault_barrier_error 'K fault barrier authorization does not match the fenced attempt'
    return 1
  }
  case "${K_FAULT_BARRIER_TIMEOUT_SECONDS:-}" in
    ''|*[!0-9]*|0)
      production_runtime_fault_barrier_error 'K fault barrier timeout must be a positive integer'
      return 1
      ;;
  esac
}

production_runtime_wait_for_k_fault_injection() {
  local ready_fifo="${K_FAULT_BARRIER_READY_FIFO:-}"
  local ack_fifo="${K_FAULT_BARRIER_ACK_FIFO:-}"
  local transaction_id="${K_FAULT_TRANSACTION_ID:-}"
  local timeout_seconds="${K_FAULT_BARRIER_TIMEOUT_SECONDS:-}"
  local acknowledgement=""

  [ -z "${K_FAULT_MODE:-}" ] && return 0
  production_runtime_fault_barrier_validate || return 1

  # The K watchdog is already blocked on the ready FIFO. The forward cannot
  # reach readiness/VERIFIED until the watchdog has stopped the exact target
  # and written the matching acknowledgement. There is no phase polling or
  # timing race in this path.
  if ! timeout "$timeout_seconds" bash -c \
    'printf "%s\\n" "$1" > "$2"' \
    k-fault-barrier "$transaction_id" "$ready_fifo"; then
    production_runtime_fault_barrier_error 'K fault barrier readiness handshake failed'
    return 1
  fi
  acknowledgement="$(timeout "$timeout_seconds" bash -c \
    'IFS= read -r value < "$1" && printf "%s" "$value"' \
    k-fault-barrier "$ack_fifo")" || {
    production_runtime_fault_barrier_error 'K fault barrier acknowledgement timed out'
    return 1
  }
  [ "$acknowledgement" = "FAULT_INJECTED:$transaction_id" ] || {
    production_runtime_fault_barrier_error 'K fault barrier acknowledgement did not match the current attempt'
    return 1
  }
}

plan_production_runtime_deploy_impl() {
  PRODUCTION_DEPLOY_PLAN="release-candidate"
}

ensure_production_release_candidate_runtime_env() {
  if [ "${PRODUCTION_DEPLOY_PLAN:-}" != "release-candidate" ]; then
    return 0
  fi

  if [ -z "${RELEASE_ID:-}" ] ||
    [ -z "${RC_RUN_ID:-}" ] ||
    [ -z "${OPENPATH_SHA:-}" ] ||
    [ -z "${OPENPATH_CONTRACT_SHA256:-}" ] ||
    [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] ||
    [ -z "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ] ||
    [ -z "${OPENPATH_VERSION:-}" ] ||
    [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] ||
    [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}" ]; then
    log_error "Verified Release Bundle v2 did not export the complete immutable runtime identity"
    return 1
  fi

  require_openpath_linux_agent_runtime_pin || return 1
  require_windows_offline_installer_runtime_pin || return 1

  return 0
}

validate_production_runtime_projection_live() {
  DEPLOY_RUNTIME_PROJECTION_FILE="${DEPLOYMENT_STATE_RELEASES_DIR:-$STATE_DIR/releases}/${RELEASE_ID:-}/runtime.env"
  DEPLOY_RUNTIME_PROJECTION_SERVICES="classroompath-gateway classroompath-api"
  export DEPLOY_RUNTIME_PROJECTION_FILE DEPLOY_RUNTIME_PROJECTION_SERVICES
  deploy_runtime_validate_live_projection
}

production_runtime_adapter_prepare() {
  FAILURE_POINT=host-contract
  FAILURE_CATEGORY=host-contract
  FAILURE_MESSAGE='production runtime preparation prerequisites failed'
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  cd "$APP_DIR/docker" || return 1
  declare -f activate_openpath_firefox_assets_generation >/dev/null 2>&1 || return 1
  declare -f production_runtime_activate_prepared_files >/dev/null 2>&1 || return 1
  export COMPOSE_PROJECT_NAME=classroompath-production
  configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/amd64}" || return 1
  verify_deploy_container_platform || return 1
  ensure_production_release_candidate_runtime_env || return 1

  if declare -f cleanup_production_disk_if_needed >/dev/null 2>&1; then
    cleanup_production_disk_if_needed || return 1
  fi

  login_production_registry || return 1

  log_info "Preparing OpenPath Firefox release assets..."
  FAILURE_POINT=firefox-assets
  FAILURE_CATEGORY=runtime-projection
  FAILURE_MESSAGE='candidate Firefox assets could not be prepared'
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "${TARGET_SHA:-current}" prepare-only || return 1

  log_info "Pulling immutable release images..."
  FAILURE_POINT="docker-pull"
  FAILURE_CATEGORY="image-pull"
  FAILURE_MESSAGE="immutable production image pull failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  docker compose pull gateway api windows-offline-installer-provision spa || return 1

  # Persist the candidate bundle and runtime projection before stopping the
  # known-good containers. This makes every post-switch state recoverable and
  # moves verifier/state failures to the pre-mutation side of the boundary.
  FAILURE_POINT="state-persistence"
  FAILURE_CATEGORY="state-write"
  FAILURE_MESSAGE="candidate release state persistence failed before switch"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  write_release_runtime_state \
    "${DEPLOYMENT_STATE_PENDING_FILE:-$STATE_DIR/pending-images.env}" \
    "$TARGET_SHA" \
    "release-candidate" \
    "$CLASSROOMPATH_GATEWAY_IMAGE" \
    "$CLASSROOMPATH_MIGRATIONS_IMAGE" \
    "$OPENPATH_FIREFOX_ASSETS_IMAGE" \
    "$OPENPATH_API_IMAGE" \
    "${OPENPATH_VERSION:-}" \
    "${OPENPATH_LINUX_AGENT_VERSION:-}" \
    "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" \
    "$CLASSROOMPATH_SPA_IMAGE" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256" \
    "$RELEASE_ID" \
    "$OPENPATH_SHA" \
    "$OPENPATH_CONTRACT_SHA256" \
    "$CLASSROOMPATH_VERIFIER_IMAGE" \
    "$RC_RUN_ID" || return 1

  deployment_state_persist_v2_release \
    "$RELEASE_BUNDLE_FILE" \
    "$OPENPATH_CONTRACT_FILE" \
    "$RELEASE_ID" \
    "$RC_RUN_ID" || return 1

  FAILURE_POINT="runtime-projection"
  FAILURE_CATEGORY="state-write"
  FAILURE_MESSAGE="candidate runtime projection materialization failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  PRODUCTION_CANDIDATE_ENV_FILE="$(mktemp "$STATE_DIR/candidate-config.XXXXXX")" || return 1
  export PRODUCTION_CANDIDATE_ENV_FILE
  cp "$APP_DIR/config/.env" "$PRODUCTION_CANDIDATE_ENV_FILE" || return 1
  chmod 600 "$PRODUCTION_CANDIDATE_ENV_FILE" || return 1
  apply_release_runtime_projection_to_env_file \
    "${DEPLOYMENT_STATE_RELEASES_DIR:-$STATE_DIR/releases}/$RELEASE_ID/runtime.env" \
    "$PRODUCTION_CANDIDATE_ENV_FILE" || return 1
  upsert_env_file_var "$PRODUCTION_CANDIDATE_ENV_FILE" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release || return 1
  export CP_REQUIRE_PUSH_NOTIFICATIONS=1
  bash "$APP_DIR/scripts/sync-billing-env.sh" "$PRODUCTION_CANDIDATE_ENV_FILE" || return 1
  bash "$APP_DIR/scripts/validate-runtime-config-docker.sh" --app-dir "$APP_DIR" --env-file "$PRODUCTION_CANDIDATE_ENV_FILE" || return 1

}

production_runtime_activate_prepared_files() {
  local installed_env=""
  [ "${MUTATION_BOUNDARY_REACHED:-0}" = 1 ] || return 1
  [ -f "${PRODUCTION_CANDIDATE_ENV_FILE:-}" ] && [ ! -L "$PRODUCTION_CANDIDATE_ENV_FILE" ] || return 1
  # Install only the config already validated in PREPARE. The sensitive temp
  # file is removed by the entrypoint's EXIT cleanup on success or failure.
  installed_env="$(mktemp "$APP_DIR/config/.env.candidate.XXXXXX")" || return 1
  if ! install -m 600 "$PRODUCTION_CANDIDATE_ENV_FILE" "$installed_env" ||
    ! mv -f "$installed_env" "$APP_DIR/config/.env"; then
    rm -f "$installed_env"
    return 1
  fi
  activate_openpath_firefox_assets_generation || return 1
}

production_runtime_adapter_switch() {
  FAILURE_POINT="container-switch"
  FAILURE_CATEGORY="container-switch"
  FAILURE_MESSAGE="production candidate container switch failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  log_info "Stopping existing containers..."
  docker compose down --remove-orphans || return 1
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  docker rm -f classroompath-production-api-1 classroompath-production-gateway-1 classroompath-production-spa-1 2>/dev/null || true
  log_info "Starting containers from immutable images..."
  docker compose up -d --force-recreate --no-build || return 1
}

production_runtime_adapter_validate_live() {
  FAILURE_POINT="runtime-projection-live"
  FAILURE_CATEGORY="runtime-attestation"
  FAILURE_MESSAGE="live production runtime projection does not match the verified release"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  validate_production_runtime_projection_live
}

production_runtime_adapter_fault_barrier() {
  production_runtime_wait_for_k_fault_injection
}

production_runtime_ensure_shared_executor() {
  if declare -f deploy_runtime_wait_for_health_and_readiness >/dev/null 2>&1; then
    return 0
  fi

  local runtime_script_dir=""
  local executor_path="${DEPLOY_RUNTIME_EXECUTOR_HELPER_PATH:-}"
  runtime_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || return 1
  if [ -z "$executor_path" ]; then
    executor_path="$runtime_script_dir/deploy-runtime-executor.sh"
  fi
  [ -f "$executor_path" ] && [ ! -L "$executor_path" ] || {
    production_runtime_fault_barrier_error 'Shared runtime executor helper is unavailable'
    return 1
  }
  # This is a load seam for direct helper consumers and test harnesses; the
  # production deploy path normally sources the executor during bootstrap.
  # Readiness semantics still have one implementation in this helper.
  source "$executor_path"
  declare -f deploy_runtime_wait_for_health_and_readiness >/dev/null 2>&1 || {
    production_runtime_fault_barrier_error 'Shared runtime executor helper is incomplete'
    return 1
  }
}

deploy_runtime_adapter_recover() {
  local recovery_artifact_path="${RECOVERY_ARTIFACT_PATH:-}"
  local recovery_artifact_sha256="${RECOVERY_ARTIFACT_SHA256:-}"
  local recovery_executor_sha256="${RECOVERY_EXECUTOR_SHA256:-}"
  local recovery_executor_path=""
  local expected_artifact_path=""
  local actual_artifact_sha256=""
  local actual_executor_sha256=""

  # The common executor owns the recovery boundary and terminal result. The
  # recovery adapter may only execute the exact, preflighted R bytes persisted
  # by production_recovery_artifact_prepare; it cannot select a source path.
  if [ -z "$recovery_artifact_path" ] ||
    [ -z "$recovery_artifact_sha256" ] ||
    [[ ! "$recovery_artifact_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    [[ ! "$recovery_executor_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    log_error "Exact production recovery artifact identity is unavailable"
    return 1
  fi
  expected_artifact_path="${CLASSROOMPATH_DEPLOY_ROOT%/}/recovery/releases/$recovery_artifact_sha256/production-recovery-bundle.tgz"
  if [ "$recovery_artifact_path" != "$expected_artifact_path" ] ||
    [ ! -f "$recovery_artifact_path" ] || [ -L "$recovery_artifact_path" ]; then
    log_error "Persisted production recovery artifact path is not exact"
    return 1
  fi
  recovery_executor_path="${recovery_artifact_path%/*}/production-recovery-executor.sh"
  if [ ! -f "$recovery_executor_path" ] || [ -L "$recovery_executor_path" ]; then
    log_error "Persisted production recovery executor is unavailable"
    return 1
  fi
  actual_artifact_sha256="$(sha256sum "$recovery_artifact_path" | awk '{print $1; exit}')"
  actual_executor_sha256="$(sha256sum "$recovery_executor_path" | awk '{print $1; exit}')"
  if [ "$actual_artifact_sha256" != "$recovery_artifact_sha256" ] ||
    [ "$actual_executor_sha256" != "$recovery_executor_sha256" ]; then
    log_error "Persisted production recovery bytes do not match their exact identity"
    return 1
  fi

  PRODUCTION_RECOVERY_SHA="${PRODUCTION_RECOVERY_SHA:-${RECOVERY_SOURCE_SHA:-}}" \
  PRODUCTION_RECOVERY_SOURCE_SHA="${PRODUCTION_RECOVERY_SOURCE_SHA:-${RECOVERY_SOURCE_SHA:-}}" \
  PRODUCTION_RECOVERY_SOURCE_VERSION="${PRODUCTION_RECOVERY_SOURCE_VERSION:-${RECOVERY_SOURCE_VERSION:-}}" \
  PRODUCTION_RECOVERY_CONTRACT_VERSION="${PRODUCTION_RECOVERY_CONTRACT_VERSION:-${RECOVERY_CONTRACT_VERSION:-}}" \
  PRODUCTION_RECOVERY_ARTIFACT_SHA256="$recovery_artifact_sha256" \
  PRODUCTION_RECOVERY_EXECUTOR_SHA256="$recovery_executor_sha256" \
  PRODUCTION_RECOVERY_PREFLIGHT_ONLY=0 \
    bash "$recovery_executor_path"
}

start_production_runtime_impl() {
  plan_production_runtime_deploy_impl
  production_runtime_adapter_prepare
  production_runtime_adapter_switch
}

wait_for_production_runtime_readiness_impl() {
  production_runtime_ensure_shared_executor || return 1
  DEPLOY_RUNTIME_HEALTH_URL="${PRODUCTION_GATEWAY_HEALTH_URL:-http://localhost:3001/cp/health}"
  DEPLOY_RUNTIME_READY_URL="${PRODUCTION_READY_URL:-http://localhost:3001/cp/ready}"
  export DEPLOY_RUNTIME_HEALTH_URL DEPLOY_RUNTIME_READY_URL
  deploy_runtime_wait_for_health_and_readiness
}
