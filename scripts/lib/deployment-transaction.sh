#!/usr/bin/env bash
# deployment-transaction.sh - Atomic production executor state machine
# shellcheck shell=bash

DEPLOYMENT_TRANSACTION_HELPER_CONTRACT_VERSION=1

DEPLOYMENT_PHASE_PREPARED=PREPARED
DEPLOYMENT_PHASE_SWITCHING=SWITCHING
DEPLOYMENT_PHASE_ACTIVATED_UNVERIFIED=ACTIVATED_UNVERIFIED
DEPLOYMENT_PHASE_VERIFIED=VERIFIED
DEPLOYMENT_PHASE_COMMITTED=COMMITTED
DEPLOYMENT_PHASE_ROLLING_BACK=ROLLING_BACK
DEPLOYMENT_PHASE_ROLLED_BACK=ROLLED_BACK
DEPLOYMENT_PHASE_FAILED=FAILED

deployment_transaction_log_error() {
  if declare -f log_error >/dev/null 2>&1; then
    log_error "$*"
  else
    printf '[ERROR] %s\n' "$*" >&2
  fi
}

deployment_transaction_is_allowed_transition() {
  local current_phase="$1"
  local next_phase="$2"

  case "$current_phase:$next_phase" in
    PREPARED:SWITCHING|PREPARED:FAILED) return 0 ;;
    SWITCHING:ACTIVATED_UNVERIFIED|SWITCHING:FAILED|SWITCHING:ROLLING_BACK) return 0 ;;
    ACTIVATED_UNVERIFIED:VERIFIED|ACTIVATED_UNVERIFIED:FAILED|ACTIVATED_UNVERIFIED:ROLLING_BACK) return 0 ;;
    VERIFIED:COMMITTED|VERIFIED:FAILED|VERIFIED:ROLLING_BACK) return 0 ;;
    FAILED:ROLLING_BACK) return 0 ;;
    ROLLING_BACK:ROLLED_BACK|ROLLING_BACK:FAILED) return 0 ;;
    *) return 1 ;;
  esac
}

deployment_transaction_read_phase() {
  local state_file="${1:-${DEPLOYMENT_TRANSACTION_FILE:-}}"
  local phase=""

  [ -s "$state_file" ] || return 1
  phase="$(awk -F= '$1 == "DEPLOYMENT_PHASE" { print substr($0, index($0, "=") + 1); exit }' "$state_file")"
  [ -n "$phase" ] || return 1
  printf '%s\n' "$phase"
}

deployment_transaction_read_value() {
  local state_file="${1:-${DEPLOYMENT_TRANSACTION_FILE:-}}"
  local key="$2"

  [ -f "$state_file" ] || return 1
  awk -F= -v expected_key="$key" '$1 == expected_key { print substr($0, index($0, "=") + 1); exit }' "$state_file"
}

deployment_transaction_write() {
  local state_file="${1:-${DEPLOYMENT_TRANSACTION_FILE:-}}"
  local state_dir=""
  local tmp_file=""
  local field=""
  local value=""
  local -a fields=(
    DEPLOYMENT_TRANSACTION_VERSION
    DEPLOYMENT_PHASE
    DEPLOYMENT_STAGE
    DEPLOYMENT_PHASE_STARTED_AT
    DEPLOYMENT_PHASE_UPDATED_AT
    MUTATION_BOUNDARY_REACHED
    REQUESTED_RELEASE_ID
    CANDIDATE_RELEASE_ID
    CURRENT_RELEASE_ID
    PREVIOUS_RELEASE_ID
    FAILURE_POINT
    FAILURE_CATEGORY
    FAILURE_MESSAGE
    ROLLBACK_PHASE
    ROLLBACK_ATTEMPTED
    ROLLBACK_RESULT
    RECOVERY_ARTIFACT_VERSION
    RECOVERY_ARTIFACT_SHA256
    RECOVERY_EXECUTOR_SHA256
    RECOVERY_ARTIFACT_PATH
    RECOVERY_ARTIFACT_SOURCE_SHA
  )

  [ -n "$state_file" ] || return 1
  state_dir="$(dirname "$state_file")"
  mkdir -p "$state_dir"
  tmp_file="$(mktemp "$state_file.tmp.XXXXXX")" || return 1
  umask 077
  for field in "${fields[@]}"; do
    value="${!field:-}"
    printf '%s=%q\n' "$field" "$value" >> "$tmp_file"
  done
  if ! mv "$tmp_file" "$state_file"; then
    rm -f "$tmp_file"
    return 1
  fi
  return 0
}

deployment_transaction_init() {
  local state_file="$1"
  local previous_release_id="${2:-${PREVIOUS_RELEASE_ID:-}}"
  local candidate_release_id="${3:-${CANDIDATE_RELEASE_ID:-${RELEASE_ID:-}}}"
  local now=""

  DEPLOYMENT_TRANSACTION_FILE="$state_file"
  DEPLOYMENT_TRANSACTION_VERSION=1
  DEPLOYMENT_PHASE="$DEPLOYMENT_PHASE_PREPARED"
  DEPLOYMENT_STAGE="RESOLVE"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  DEPLOYMENT_PHASE_STARTED_AT="$now"
  DEPLOYMENT_PHASE_UPDATED_AT="$now"
  MUTATION_BOUNDARY_REACHED=0
  REQUESTED_RELEASE_ID="${REQUESTED_RELEASE_ID:-$candidate_release_id}"
  CANDIDATE_RELEASE_ID="$candidate_release_id"
  CURRENT_RELEASE_ID="${CURRENT_RELEASE_ID:-$previous_release_id}"
  PREVIOUS_RELEASE_ID="$previous_release_id"
  FAILURE_POINT=""
  FAILURE_CATEGORY=""
  FAILURE_MESSAGE=""
  ROLLBACK_PHASE="NOT_STARTED"
  ROLLBACK_ATTEMPTED=0
  ROLLBACK_RESULT="not_attempted"
  RECOVERY_ARTIFACT_VERSION=""
  RECOVERY_ARTIFACT_SHA256=""
  RECOVERY_EXECUTOR_SHA256=""
  RECOVERY_ARTIFACT_PATH=""
  RECOVERY_ARTIFACT_SOURCE_SHA=""
  export DEPLOYMENT_TRANSACTION_FILE DEPLOYMENT_TRANSACTION_VERSION DEPLOYMENT_PHASE DEPLOYMENT_STAGE
  export DEPLOYMENT_PHASE_STARTED_AT DEPLOYMENT_PHASE_UPDATED_AT MUTATION_BOUNDARY_REACHED
  export REQUESTED_RELEASE_ID CANDIDATE_RELEASE_ID CURRENT_RELEASE_ID PREVIOUS_RELEASE_ID
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE ROLLBACK_PHASE ROLLBACK_ATTEMPTED ROLLBACK_RESULT
  export RECOVERY_ARTIFACT_VERSION RECOVERY_ARTIFACT_SHA256 RECOVERY_EXECUTOR_SHA256
  export RECOVERY_ARTIFACT_PATH RECOVERY_ARTIFACT_SOURCE_SHA
  deployment_transaction_write "$state_file"
}

deployment_transaction_set_release_identity() {
  local previous_release_id="${1:-${PREVIOUS_RELEASE_ID:-}}"
  local candidate_release_id="${2:-${CANDIDATE_RELEASE_ID:-${RELEASE_ID:-}}}"
  local current_release_id="${3:-${CURRENT_RELEASE_ID:-$previous_release_id}}"

  PREVIOUS_RELEASE_ID="$previous_release_id"
  CANDIDATE_RELEASE_ID="$candidate_release_id"
  REQUESTED_RELEASE_ID="${REQUESTED_RELEASE_ID:-$candidate_release_id}"
  CURRENT_RELEASE_ID="$current_release_id"
  export PREVIOUS_RELEASE_ID CANDIDATE_RELEASE_ID REQUESTED_RELEASE_ID CURRENT_RELEASE_ID
  deployment_transaction_write "${DEPLOYMENT_TRANSACTION_FILE:-}"
}

deployment_transaction_set_recovery_artifact() {
  local artifact_version="${1:-}"
  local artifact_sha256="${2:-}"
  local executor_sha256="${3:-}"
  local artifact_path="${4:-}"
  local source_sha="${5:-}"

  RECOVERY_ARTIFACT_VERSION="$artifact_version"
  RECOVERY_ARTIFACT_SHA256="$artifact_sha256"
  RECOVERY_EXECUTOR_SHA256="$executor_sha256"
  RECOVERY_ARTIFACT_PATH="$artifact_path"
  RECOVERY_ARTIFACT_SOURCE_SHA="$source_sha"
  export RECOVERY_ARTIFACT_VERSION RECOVERY_ARTIFACT_SHA256 RECOVERY_EXECUTOR_SHA256
  export RECOVERY_ARTIFACT_PATH RECOVERY_ARTIFACT_SOURCE_SHA
  deployment_transaction_write "${DEPLOYMENT_TRANSACTION_FILE:-}"
}

deployment_transaction_mark_stage() {
  local stage="$1"
  local now=""

  [ -n "$stage" ] || return 1
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  DEPLOYMENT_STAGE="$stage"
  DEPLOYMENT_PHASE_UPDATED_AT="$now"
  export DEPLOYMENT_STAGE DEPLOYMENT_PHASE_UPDATED_AT
  deployment_transaction_write "${DEPLOYMENT_TRANSACTION_FILE:-}"
}

deployment_transaction_transition() {
  local next_phase="$1"
  local stage="${2:-$next_phase}"
  local current_phase="${DEPLOYMENT_PHASE:-}"
  local now=""
  local previous_stage="${DEPLOYMENT_STAGE:-}"
  local previous_updated_at="${DEPLOYMENT_PHASE_UPDATED_AT:-}"
  local previous_mutation_boundary="${MUTATION_BOUNDARY_REACHED:-0}"
  local previous_current_release_id="${CURRENT_RELEASE_ID:-}"
  local previous_rollback_phase="${ROLLBACK_PHASE:-}"
  local previous_rollback_attempted="${ROLLBACK_ATTEMPTED:-0}"
  local previous_rollback_result="${ROLLBACK_RESULT:-not_attempted}"

  if [ -z "$current_phase" ] && [ -n "${DEPLOYMENT_TRANSACTION_FILE:-}" ]; then
    current_phase="$(deployment_transaction_read_phase "$DEPLOYMENT_TRANSACTION_FILE")" || return 1
  fi
  if ! deployment_transaction_is_allowed_transition "$current_phase" "$next_phase"; then
    deployment_transaction_log_error "Invalid deployment transition: $current_phase -> $next_phase"
    return 1
  fi
  if [ "$next_phase" = "$DEPLOYMENT_PHASE_ROLLING_BACK" ] &&
    [ "${MUTATION_BOUNDARY_REACHED:-0}" != "1" ]; then
    deployment_transaction_log_error "Rollback requires the mutation boundary"
    return 1
  fi

  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  DEPLOYMENT_PHASE="$next_phase"
  DEPLOYMENT_STAGE="$stage"
  DEPLOYMENT_PHASE_UPDATED_AT="$now"
  if [ "$next_phase" = "$DEPLOYMENT_PHASE_SWITCHING" ]; then
    MUTATION_BOUNDARY_REACHED=1
  fi
  if [ "$next_phase" = "$DEPLOYMENT_PHASE_COMMITTED" ]; then
    CURRENT_RELEASE_ID="$CANDIDATE_RELEASE_ID"
  fi
  if [ "$next_phase" = "$DEPLOYMENT_PHASE_ROLLED_BACK" ]; then
    CURRENT_RELEASE_ID="$PREVIOUS_RELEASE_ID"
    ROLLBACK_ATTEMPTED=1
    ROLLBACK_RESULT="success"
    ROLLBACK_PHASE="ROLLED_BACK"
  fi
  export DEPLOYMENT_PHASE DEPLOYMENT_STAGE DEPLOYMENT_PHASE_UPDATED_AT
  export MUTATION_BOUNDARY_REACHED CURRENT_RELEASE_ID ROLLBACK_ATTEMPTED ROLLBACK_RESULT ROLLBACK_PHASE
  if ! deployment_transaction_write "${DEPLOYMENT_TRANSACTION_FILE:-}"; then
    DEPLOYMENT_PHASE="$current_phase"
    DEPLOYMENT_STAGE="$previous_stage"
    DEPLOYMENT_PHASE_UPDATED_AT="$previous_updated_at"
    MUTATION_BOUNDARY_REACHED="$previous_mutation_boundary"
    CURRENT_RELEASE_ID="$previous_current_release_id"
    ROLLBACK_PHASE="$previous_rollback_phase"
    ROLLBACK_ATTEMPTED="$previous_rollback_attempted"
    ROLLBACK_RESULT="$previous_rollback_result"
    export DEPLOYMENT_PHASE DEPLOYMENT_STAGE DEPLOYMENT_PHASE_UPDATED_AT
    export MUTATION_BOUNDARY_REACHED CURRENT_RELEASE_ID ROLLBACK_PHASE
    export ROLLBACK_ATTEMPTED ROLLBACK_RESULT
    return 1
  fi
}

deployment_transaction_mark_failure() {
  local point="${1:-unknown}"
  local category="${2:-remote-connectivity}"
  local message="${3:-deployment failed}"

  FAILURE_POINT="$point"
  FAILURE_CATEGORY="$category"
  FAILURE_MESSAGE="$message"
  DEPLOYMENT_STAGE="${4:-${DEPLOYMENT_STAGE:-FAILED}}"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE DEPLOYMENT_STAGE

  if [ "${DEPLOYMENT_PHASE:-}" != "$DEPLOYMENT_PHASE_FAILED" ]; then
    deployment_transaction_transition "$DEPLOYMENT_PHASE_FAILED" "$DEPLOYMENT_STAGE" || return 1
  else
    deployment_transaction_write "${DEPLOYMENT_TRANSACTION_FILE:-}" || return 1
  fi
}

deployment_transaction_begin_rollback() {
  ROLLBACK_ATTEMPTED=1
  ROLLBACK_PHASE="PREPARING"
  ROLLBACK_RESULT="running"
  export ROLLBACK_ATTEMPTED ROLLBACK_PHASE ROLLBACK_RESULT
  deployment_transaction_transition "$DEPLOYMENT_PHASE_ROLLING_BACK" "ROLLBACK"
}

deployment_transaction_mark_rollback_success() {
  ROLLBACK_ATTEMPTED=1
  ROLLBACK_PHASE="ROLLED_BACK"
  ROLLBACK_RESULT="success"
  export ROLLBACK_ATTEMPTED ROLLBACK_PHASE ROLLBACK_RESULT
  deployment_transaction_transition "$DEPLOYMENT_PHASE_ROLLED_BACK" "ROLLBACK"
}

deployment_transaction_mark_rollback_failure() {
  ROLLBACK_ATTEMPTED=1
  ROLLBACK_PHASE="${1:-FAILED}"
  ROLLBACK_RESULT="failed"
  FAILURE_POINT="${2:-rollback-failed}"
  FAILURE_CATEGORY="${3:-rollback-execution}"
  FAILURE_MESSAGE="${4:-rollback failed}"
  export ROLLBACK_ATTEMPTED ROLLBACK_PHASE ROLLBACK_RESULT
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  deployment_transaction_transition "$DEPLOYMENT_PHASE_FAILED" "ROLLBACK"
}
