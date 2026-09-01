#!/usr/bin/env bash
# rollback-executor.sh - Stable, candidate-independent rollback contract
# shellcheck shell=bash

ROLLBACK_EXECUTOR_HELPER_CONTRACT_VERSION=1

rollback_executor_log_error() {
  if declare -f log_error >/dev/null 2>&1; then
    log_error "$*"
  else
    printf '[ERROR] %s\n' "$*" >&2
  fi
}

rollback_executor_previous_release_id() {
  local pointer_file="${DEPLOYMENT_STATE_PREVIOUS_POINTER_FILE:-${STATE_DIR:-}/previous}"
  local release_id=""

  [ -s "$pointer_file" ] || return 1
  release_id="$(tr -d '\r\n' < "$pointer_file")"
  [[ "$release_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$release_id"
}

rollback_executor_previous_verifier_image() {
  local release_id=""
  local runtime_file=""
  local verifier_image=""

  release_id="$(rollback_executor_previous_release_id)" || return 1
  runtime_file="${DEPLOYMENT_STATE_RELEASES_DIR:-${STATE_DIR:-}/releases}/$release_id/runtime.env"
  [ -f "$runtime_file" ] || return 1
  verifier_image="$(awk -F= '$1 == "CLASSROOMPATH_VERIFIER_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$runtime_file")"
  [[ "$verifier_image" =~ @sha256:[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$verifier_image"
}

rollback_executor_require_immutable_image() {
  local label="$1"
  local image_ref="$2"

  if [[ ! "$image_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
    rollback_executor_log_error "Rollback $label image is not pinned by digest"
    return 1
  fi
}

rollback_executor_write_plan() {
  local plan_file="${ROLLBACK_PLAN_FILE:-${STATE_DIR:-}/rollback-plan.env}"
  local plan_dir=""
  local tmp_file=""

  plan_dir="$(dirname "$plan_file")"
  mkdir -p "$plan_dir"
  tmp_file="$(mktemp "$plan_file.tmp.XXXXXX")" || return 1
  umask 077
  {
    printf 'ROLLBACK_PLAN_VERSION=%q\n' '1'
    printf 'ROLLBACK_PLAN_SOURCE=%q\n' 'stored-previous-release'
    printf 'ROLLBACK_PREVIOUS_RELEASE_ID=%q\n' "${ROLLBACK_RELEASE_ID:-}"
    printf 'ROLLBACK_PREVIOUS_APP_SHA=%q\n' "${ROLLBACK_RELEASE_APP_SHA:-${APP_SHA:-}}"
    printf 'ROLLBACK_PREVIOUS_OPENPATH_SHA=%q\n' "${ROLLBACK_OPENPATH_SHA:-${OPENPATH_SHA:-}}"
    printf 'ROLLBACK_PREVIOUS_CONTRACT_SHA256=%q\n' "${ROLLBACK_OPENPATH_CONTRACT_SHA256:-${OPENPATH_CONTRACT_SHA256:-}}"
    printf 'ROLLBACK_PREVIOUS_GATEWAY_IMAGE=%q\n' "${CLASSROOMPATH_GATEWAY_IMAGE:-}"
    printf 'ROLLBACK_PREVIOUS_MIGRATIONS_IMAGE=%q\n' "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}"
    printf 'ROLLBACK_PREVIOUS_OPENPATH_FIREFOX_ASSETS_IMAGE=%q\n' "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}"
    printf 'ROLLBACK_PREVIOUS_OPENPATH_API_IMAGE=%q\n' "${OPENPATH_API_IMAGE:-}"
    printf 'ROLLBACK_PREVIOUS_SPA_IMAGE=%q\n' "${CLASSROOMPATH_SPA_IMAGE:-}"
    printf 'ROLLBACK_PREVIOUS_VERIFIER_IMAGE=%q\n' "${CLASSROOMPATH_VERIFIER_IMAGE:-}"
  } > "$tmp_file"
  mv "$tmp_file" "$plan_file" || {
    rm -f "$tmp_file"
    return 1
  }
  ROLLBACK_PLAN_FILE="$plan_file"
  export ROLLBACK_PLAN_FILE
}

rollback_executor_preflight() {
  local previous_release_id=""
  local previous_verifier_image=""
  local image_name=""
  local image_ref=""
  local forward_context_present=0
  local saved_release_id=""
  local saved_app_sha=""
  local saved_target_sha=""
  local saved_openpath_sha=""
  local saved_contract_sha256=""
  local saved_rc_run_id=""
  local saved_verifier_image=""
  local saved_image_source=""
  local saved_gateway_image=""
  local saved_migrations_image=""
  local saved_firefox_assets_image=""
  local saved_openpath_api_image=""
  local saved_openpath_version=""
  local saved_linux_agent_version=""
  local saved_linux_agent_apt_suite=""
  local saved_spa_image=""
  local saved_template_version=""
  local saved_template_commit=""
  local saved_template_release_tag=""
  local saved_template_sha256=""

  if ! deployment_state_v2_pointer_present previous; then
    rollback_executor_log_error "Rollback requires a durable Release Bundle v2 previous pointer"
    return 1
  fi

  previous_release_id="$(rollback_executor_previous_release_id)" || {
    rollback_executor_log_error "Rollback previous pointer is malformed"
    return 1
  }
  previous_verifier_image="$(rollback_executor_previous_verifier_image)" || {
    rollback_executor_log_error "Rollback previous release has no immutable verifier image"
    return 1
  }

  if [ -n "${RELEASE_ID:-}" ]; then
    forward_context_present=1
    saved_release_id="$RELEASE_ID"
    saved_app_sha="${APP_SHA:-}"
    saved_target_sha="${TARGET_SHA:-}"
    saved_openpath_sha="${OPENPATH_SHA:-}"
    saved_contract_sha256="${OPENPATH_CONTRACT_SHA256:-}"
    saved_rc_run_id="${RC_RUN_ID:-}"
    saved_verifier_image="${CLASSROOMPATH_VERIFIER_IMAGE:-}"
    saved_image_source="${IMAGE_SOURCE:-}"
    saved_gateway_image="${CLASSROOMPATH_GATEWAY_IMAGE:-}"
    saved_migrations_image="${CLASSROOMPATH_MIGRATIONS_IMAGE:-}"
    saved_firefox_assets_image="${OPENPATH_FIREFOX_ASSETS_IMAGE:-}"
    saved_openpath_api_image="${OPENPATH_API_IMAGE:-}"
    saved_openpath_version="${OPENPATH_VERSION:-}"
    saved_linux_agent_version="${OPENPATH_LINUX_AGENT_VERSION:-}"
    saved_linux_agent_apt_suite="${OPENPATH_LINUX_AGENT_APT_SUITE:-}"
    saved_spa_image="${CLASSROOMPATH_SPA_IMAGE:-}"
    saved_template_version="${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}"
    saved_template_commit="${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}"
    saved_template_release_tag="${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}"
    saved_template_sha256="${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}"
  fi

  # Select the verifier from the stored previous release before reading any
  # state. This prevents the candidate/current verifier from becoming the
  # rollback authority after a failed promotion.
  CLASSROOMPATH_VERIFIER_IMAGE="$previous_verifier_image"
  export CLASSROOMPATH_VERIFIER_IMAGE
  DEPLOYMENT_STATE_USE_VERIFIER=1
  export DEPLOYMENT_STATE_USE_VERIFIER

  deployment_state_load_previous_release || {
    rollback_executor_log_error "Stored previous Release Bundle could not be verified"
    return 1
  }
  [ "${DEPLOYMENT_STATE_RELEASE_ID:-}" = "$previous_release_id" ] || {
    rollback_executor_log_error "Verified rollback state does not match the previous pointer"
    return 1
  }

  if [ "${IMAGE_SOURCE:-}" != "release-candidate" ]; then
    rollback_executor_log_error "Rollback supports only stored release-candidate bundles"
    return 1
  fi
  if declare -f require_openpath_linux_agent_runtime_pin >/dev/null 2>&1; then
    require_openpath_linux_agent_runtime_pin || return 1
  fi
  if declare -f require_windows_offline_installer_runtime_pin >/dev/null 2>&1; then
    require_windows_offline_installer_runtime_pin || return 1
  fi

  for image_name in \
    CLASSROOMPATH_GATEWAY_IMAGE \
    CLASSROOMPATH_MIGRATIONS_IMAGE \
    OPENPATH_FIREFOX_ASSETS_IMAGE \
    OPENPATH_API_IMAGE \
    CLASSROOMPATH_SPA_IMAGE \
    CLASSROOMPATH_VERIFIER_IMAGE; do
    image_ref="${!image_name:-}"
    rollback_executor_require_immutable_image "$image_name" "$image_ref" || return 1
  done

  ROLLBACK_RELEASE_APP_SHA="${APP_SHA:-}"
  ROLLBACK_RELEASE_IMAGE_SOURCE="${IMAGE_SOURCE:-}"
  ROLLBACK_RELEASE_ID="$previous_release_id"
  ROLLBACK_RELEASE_RC_RUN_ID="${RC_RUN_ID:-}"
  ROLLBACK_OPENPATH_SHA="${OPENPATH_SHA:-}"
  ROLLBACK_OPENPATH_CONTRACT_SHA256="${OPENPATH_CONTRACT_SHA256:-}"
  ROLLBACK_RELEASE_VERIFIER_IMAGE="$previous_verifier_image"
  export ROLLBACK_RELEASE_APP_SHA ROLLBACK_RELEASE_IMAGE_SOURCE ROLLBACK_RELEASE_ID
  export ROLLBACK_RELEASE_RC_RUN_ID ROLLBACK_OPENPATH_SHA ROLLBACK_OPENPATH_CONTRACT_SHA256
  export ROLLBACK_RELEASE_VERIFIER_IMAGE

  rollback_executor_write_plan || return 1

  if [ "$forward_context_present" -eq 1 ]; then
    RELEASE_ID="$saved_release_id"
    APP_SHA="$saved_app_sha"
    TARGET_SHA="$saved_target_sha"
    OPENPATH_SHA="$saved_openpath_sha"
    OPENPATH_CONTRACT_SHA256="$saved_contract_sha256"
    RC_RUN_ID="$saved_rc_run_id"
    CLASSROOMPATH_VERIFIER_IMAGE="$saved_verifier_image"
    IMAGE_SOURCE="$saved_image_source"
    CLASSROOMPATH_GATEWAY_IMAGE="$saved_gateway_image"
    CLASSROOMPATH_MIGRATIONS_IMAGE="$saved_migrations_image"
    OPENPATH_FIREFOX_ASSETS_IMAGE="$saved_firefox_assets_image"
    OPENPATH_API_IMAGE="$saved_openpath_api_image"
    OPENPATH_VERSION="$saved_openpath_version"
    OPENPATH_LINUX_AGENT_VERSION="$saved_linux_agent_version"
    OPENPATH_LINUX_AGENT_APT_SUITE="$saved_linux_agent_apt_suite"
    CLASSROOMPATH_SPA_IMAGE="$saved_spa_image"
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION="$saved_template_version"
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT="$saved_template_commit"
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG="$saved_template_release_tag"
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256="$saved_template_sha256"
    export RELEASE_ID APP_SHA TARGET_SHA OPENPATH_SHA OPENPATH_CONTRACT_SHA256 RC_RUN_ID
    export CLASSROOMPATH_VERIFIER_IMAGE IMAGE_SOURCE CLASSROOMPATH_GATEWAY_IMAGE
    export CLASSROOMPATH_MIGRATIONS_IMAGE OPENPATH_FIREFOX_ASSETS_IMAGE OPENPATH_API_IMAGE
    export OPENPATH_VERSION OPENPATH_LINUX_AGENT_VERSION OPENPATH_LINUX_AGENT_APT_SUITE
    export CLASSROOMPATH_SPA_IMAGE OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION
    export OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG
    export OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256
  fi
}

rollback_executor_begin() {
  if declare -f deployment_transaction_begin_rollback >/dev/null 2>&1; then
    deployment_transaction_begin_rollback
  else
    ROLLBACK_ATTEMPTED=1
    ROLLBACK_PHASE="PREPARING"
    ROLLBACK_RESULT="running"
    export ROLLBACK_ATTEMPTED ROLLBACK_PHASE ROLLBACK_RESULT
  fi
}

rollback_executor_mark_success() {
  if declare -f deployment_transaction_mark_rollback_success >/dev/null 2>&1; then
    deployment_transaction_mark_rollback_success
  else
    ROLLBACK_ATTEMPTED=1
    ROLLBACK_PHASE="ROLLED_BACK"
    ROLLBACK_RESULT="success"
    export ROLLBACK_ATTEMPTED ROLLBACK_PHASE ROLLBACK_RESULT
  fi
}

rollback_executor_mark_failure() {
  local phase="${1:-FAILED}"
  local point="${2:-rollback-execution}"
  local category="${3:-rollback-execution}"
  local message="${4:-rollback executor failed}"

  if declare -f deployment_transaction_mark_rollback_failure >/dev/null 2>&1; then
    deployment_transaction_mark_rollback_failure "$phase" "$point" "$category" "$message"
  else
    ROLLBACK_ATTEMPTED=1
    ROLLBACK_PHASE="$phase"
    ROLLBACK_RESULT="failed"
    export ROLLBACK_ATTEMPTED ROLLBACK_PHASE ROLLBACK_RESULT
    return 1
  fi
}
