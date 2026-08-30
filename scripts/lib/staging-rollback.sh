#!/usr/bin/env bash
# staging-rollback.sh - fail-closed rollback for the remote staging runtime
# shellcheck shell=bash

STAGING_ROLLBACK_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_ROLLBACK_READINESS_HELPER_PATH="$STAGING_ROLLBACK_HELPER_DIR/rollback-readiness.sh"
if [ ! -f "$STAGING_ROLLBACK_READINESS_HELPER_PATH" ]; then
  log_error "Rollback readiness helper not found: $STAGING_ROLLBACK_READINESS_HELPER_PATH"
  return 1
fi

# shellcheck source=rollback-readiness.sh
source "$STAGING_ROLLBACK_READINESS_HELPER_PATH"

staging_rollback_mark_failed() {
  ROLLBACK_RESULT="failed"
  if ! write_deploy_context; then
    log_error "Unable to persist failed staging rollback state"
  fi
  return 1
}

staging_rollback_wait_for_health_and_readiness() {
  rollback_wait_for_health_and_readiness \
    "${STAGING_ROLLBACK_PUBLIC_URL:-http://localhost:3001}" \
    "${STAGING_ROLLBACK_READINESS_ATTEMPTS:-12}" \
    "${STAGING_ROLLBACK_READINESS_DELAY_SECONDS:-5}" \
    "${STAGING_ROLLBACK_CURL_TIMEOUT_SECONDS:-10}"
}

restore_previous_release_state() {
  local previous_state_file="${PREVIOUS_STATE_FILE:-}"
  local current_state_file="${CURRENT_STATE_FILE:-}"
  local app_dir="${APP_DIR:-}"

  if [ ! -f "$previous_state_file" ]; then
    log_warn "No previous release metadata available; cannot restore previous release"
    ROLLBACK_RESULT="unavailable"
    if ! write_deploy_context; then
      log_error "Unable to persist unavailable staging rollback state"
    fi
    return 1
  fi

  log_warn "Attempting to restore previous staging release state..."
  # shellcheck disable=SC2034 # persisted by the caller's release-state helper
  ROLLBACK_ATTEMPTED=1
  if ! write_deploy_context; then
    staging_rollback_mark_failed || return 1
  fi

  set -a
  # shellcheck disable=SC1090 # the previous release snapshot is operator state
  if ! . "$previous_state_file"; then
    set +a
    log_error "Previous staging release metadata could not be loaded"
    staging_rollback_mark_failed || return 1
  fi
  set +a

  # Never restore a pre-canonical ClassroomPath release. The complete
  # OpenPath installer pin is the compatibility boundary for both source and
  # release-candidate rollback paths.
  if ! require_windows_offline_installer_runtime_pin; then
    staging_rollback_mark_failed || return 1
  fi

  if ! git checkout --detach "$APP_SHA"; then
    staging_rollback_mark_failed || return 1
  fi
  if ! git reset --hard "$APP_SHA"; then
    staging_rollback_mark_failed || return 1
  fi
  if ! git submodule sync --recursive; then
    staging_rollback_mark_failed || return 1
  fi
  if ! git submodule update --init --recursive --force; then
    staging_rollback_mark_failed || return 1
  fi

  if ! cd "$app_dir/docker"; then
    staging_rollback_mark_failed || return 1
  fi
  export COMPOSE_PROJECT_NAME=classroompath-staging

  if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}"; then
    staging_rollback_mark_failed || return 1
  fi
  if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}"; then
    staging_rollback_mark_failed || return 1
  fi
  if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}"; then
    staging_rollback_mark_failed || return 1
  fi
  if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256 "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}"; then
    staging_rollback_mark_failed || return 1
  fi

  if [ "${IMAGE_SOURCE:-source-build}" = "release-candidate" ]; then
    export CLASSROOMPATH_GATEWAY_IMAGE
    export CLASSROOMPATH_MIGRATIONS_IMAGE
    export OPENPATH_API_IMAGE
    export CLASSROOMPATH_SPA_IMAGE
    if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"; then
      staging_rollback_mark_failed || return 1
    fi
    if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"; then
      staging_rollback_mark_failed || return 1
    fi
    if ! upsert_env_file_var "$app_dir/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"; then
      staging_rollback_mark_failed || return 1
    fi
    if ! docker compose pull gateway api windows-offline-installer-provision spa; then
      staging_rollback_mark_failed || return 1
    fi
    if ! compose_up_force_recreate_no_build; then
      staging_rollback_mark_failed || return 1
    fi
  else
    if ! remove_env_file_var "$app_dir/config/.env" OPENPATH_VERSION; then
      staging_rollback_mark_failed || return 1
    fi
    if ! remove_env_file_var "$app_dir/config/.env" OPENPATH_LINUX_AGENT_VERSION; then
      staging_rollback_mark_failed || return 1
    fi
    if ! remove_env_file_var "$app_dir/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE; then
      staging_rollback_mark_failed || return 1
    fi
    unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE
    if ! docker compose build; then
      staging_rollback_mark_failed || return 1
    fi
    if ! docker compose up -d --force-recreate; then
      staging_rollback_mark_failed || return 1
    fi
  fi

  if ! staging_rollback_wait_for_health_and_readiness; then
    staging_rollback_mark_failed || return 1
  fi

  if ! cp "$previous_state_file" "$current_state_file"; then
    staging_rollback_mark_failed || return 1
  fi
  ROLLBACK_RESULT="success"
  if ! write_deploy_context; then
    # shellcheck disable=SC2034 # persisted by the caller's release-state helper
    ROLLBACK_RESULT="failed"
    return 1
  fi
  return 0
}
