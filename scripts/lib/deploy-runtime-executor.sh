#!/usr/bin/env bash
# Environment-neutral runtime executor used by staging and production adapters.
# shellcheck shell=bash

DEPLOY_RUNTIME_EXECUTOR_CONTRACT_VERSION=1

deploy_runtime_executor_log_error() {
  if declare -f log_error >/dev/null 2>&1; then
    log_error "$*"
  else
    printf '[ERROR] %s\n' "$*" >&2
  fi
}

deploy_runtime_wait_for_health_and_readiness() {
  local health_url="${DEPLOY_RUNTIME_HEALTH_URL:-http://localhost:3001/cp/health}"
  local ready_url="${DEPLOY_RUNTIME_READY_URL:-http://localhost:3001/cp/ready}"
  local attempts="${DEPLOY_RUNTIME_READINESS_ATTEMPTS:-12}"
  local delay_seconds="${DEPLOY_RUNTIME_READINESS_DELAY_SECONDS:-5}"
  local curl_timeout="${DEPLOY_RUNTIME_CURL_TIMEOUT_SECONDS:-10}"
  local health_status=""
  local ready_response=""
  local ready_http_status=""
  local attempt=0

  FAILURE_POINT="health"
  FAILURE_CATEGORY="health"
  FAILURE_MESSAGE="candidate gateway health check failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE

  while [ "$attempt" -lt "$attempts" ]; do
    attempt=$((attempt + 1))
    if health_status="$(curl --max-time "$curl_timeout" -sS -o /dev/null -w '%{http_code}' "$health_url" 2>/dev/null)"; then
      if [ "$health_status" = "200" ]; then break; fi
    else
      health_status=0
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay_seconds"
    fi
  done

  if [ "$health_status" != "200" ]; then
    DEPLOYMENT_HEALTH_STATUS="${health_status:-0}"
    DEPLOYMENT_READY=false
    export DEPLOYMENT_HEALTH_STATUS DEPLOYMENT_READY
    deploy_runtime_executor_log_error "Gateway health did not return HTTP 200"
    return 1
  fi

  FAILURE_POINT="ready-false"
  FAILURE_CATEGORY="readiness"
  FAILURE_MESSAGE="candidate readiness did not satisfy semantic ready=true"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    attempt=$((attempt + 1))
    # Keep transport success, HTTP status, and semantic readiness separate.
    # A proxy error (or redirect) can contain a valid-looking ready payload.
    ready_http_status=""
    if ready_response="$(curl --max-time "$curl_timeout" -sS -w '\n%{http_code}' "$ready_url" 2>/dev/null)"; then
      ready_http_status="${ready_response##*$'\n'}"
      ready_response="${ready_response%$'\n'*}"
    fi
    if [ "$ready_http_status" = 200 ] &&
      declare -f rollback_readiness_json_is_ready >/dev/null 2>&1 &&
      rollback_readiness_json_is_ready "$ready_response"; then
      DEPLOYMENT_HEALTH_STATUS=200
      DEPLOYMENT_READY=true
      export DEPLOYMENT_HEALTH_STATUS DEPLOYMENT_READY
      if declare -f release_execution_mark_stage >/dev/null 2>&1; then
        release_execution_mark_stage readiness || return 1
      fi
      return 0
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay_seconds"
    fi
  done

  DEPLOYMENT_HEALTH_STATUS=200
  DEPLOYMENT_READY=false
  export DEPLOYMENT_HEALTH_STATUS DEPLOYMENT_READY
  deploy_runtime_executor_log_error "Application readiness did not satisfy semantic ready=true"
  return 1
}

deploy_runtime_validate_live_projection() {
  local projection_file="${DEPLOY_RUNTIME_PROJECTION_FILE:-}"
  local services="${DEPLOY_RUNTIME_PROJECTION_SERVICES:-classroompath-gateway classroompath-api}"
  local service=""
  local field=""
  local expected=""
  local actual=""
  local live_env=""

  [ -f "$projection_file" ] && [ ! -L "$projection_file" ] || {
    deploy_runtime_executor_log_error 'Candidate runtime projection is missing before live validation'
    return 1
  }
  if declare -f release_state_require_snapshot_fields >/dev/null 2>&1; then
    release_state_require_snapshot_fields "$projection_file" current-runtime || return 1
  fi

  for service in $services; do
    live_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$service" 2>/dev/null)" || {
      deploy_runtime_executor_log_error "Unable to inspect live runtime environment for $service"
      return 1
    }
    if declare -f release_state_list_fields >/dev/null 2>&1; then
      while IFS= read -r field; do
        [ -n "$field" ] || continue
        expected="$(release_state_snapshot_value "$projection_file" "$field")" || return 1
        actual="$(printf '%s\n' "$live_env" | awk -F= -v expected_field="$field" '$1 == expected_field { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }')" || {
          deploy_runtime_executor_log_error "$service is missing runtime projection field $field"
          return 1
        }
        if [ "$actual" != "$expected" ]; then
          deploy_runtime_executor_log_error "$service live runtime projection differs for $field"
          return 1
        fi
      done < <(release_state_list_fields current-runtime)
    fi
  done
}

deploy_runtime_record_terminal() {
  local result="$1"
  local current_sha="${2:-${DEPLOYMENT_CURRENT_SHA:-${APP_SHA:-${TARGET_SHA:-}}}}"

  DEPLOYMENT_RESULT="$result"
  DEPLOYMENT_CURRENT_SHA="$current_sha"
  if [ "$result" = COMMITTED ] || [ "$result" = ROLLED_BACK ]; then
    DEPLOYMENT_READY="${DEPLOYMENT_READY:-true}"
  else
    DEPLOYMENT_READY="${DEPLOYMENT_READY:-false}"
  fi
  export DEPLOYMENT_RESULT DEPLOYMENT_CURRENT_SHA DEPLOYMENT_READY

  if declare -f deployment_ledger_append_terminal_from_env >/dev/null 2>&1; then
    deployment_ledger_append_terminal_from_env || {
      deploy_runtime_executor_log_error 'Unable to append terminal deployment ledger fact'
      return 1
    }
  fi
}

deploy_runtime_executor_fail() {
  local message="${1:-deployment executor failed}"
  local current_phase="${DEPLOYMENT_PHASE:-}"
  local recovered=0

  FAILURE_MESSAGE="${FAILURE_MESSAGE:-$message}"
  export FAILURE_MESSAGE
  if [ -n "$current_phase" ] && declare -f deployment_transaction_mark_failure >/dev/null 2>&1 &&
    [ "$current_phase" != "${DEPLOYMENT_PHASE_COMMITTED:-COMMITTED}" ] &&
    [ "$current_phase" != "${DEPLOYMENT_PHASE_ROLLED_BACK:-ROLLED_BACK}" ]; then
    deployment_transaction_mark_failure \
      "${FAILURE_POINT:-executor-failure}" \
      "${FAILURE_CATEGORY:-runtime-executor}" \
      "$FAILURE_MESSAGE" \
      "${DEPLOYMENT_STAGE:-${FAILURE_STAGE:-FAILED}}" || true
  fi

  if [ "${MUTATION_BOUNDARY_REACHED:-0}" = "1" ] &&
    declare -f deploy_runtime_adapter_recover >/dev/null 2>&1 &&
    declare -f deployment_transaction_begin_rollback >/dev/null 2>&1; then
    deployment_transaction_begin_rollback || true
    if deploy_runtime_adapter_recover; then
      if deployment_transaction_mark_rollback_success; then
        recovered=1
      else
        deployment_transaction_mark_rollback_failure \
          PERSISTENCE rollback-state-write state-write \
          'Previous runtime restored but rollback terminal state could not be persisted' || true
      fi
    else
      deployment_transaction_mark_rollback_failure \
        ROLLBACK "${FAILURE_POINT:-rollback-failed}" "${FAILURE_CATEGORY:-rollback-execution}" \
        "${FAILURE_MESSAGE:-rollback failed}" || true
    fi
  fi

  if [ "$recovered" = "1" ]; then
    # The recovery adapter has restored and revalidated the previous release.
    # Do not carry the failed candidate's health result into the terminal
    # rollback fact.
    DEPLOYMENT_HEALTH_STATUS=200
    DEPLOYMENT_READY=true
    export DEPLOYMENT_HEALTH_STATUS DEPLOYMENT_READY
    deploy_runtime_record_terminal ROLLED_BACK "${ROLLBACK_RELEASE_APP_SHA:-${PREVIOUS_APP_SHA:-}}" || true
  else
    deploy_runtime_record_terminal FAILED "${APP_SHA:-${TARGET_SHA:-}}" || true
  fi
  deploy_runtime_executor_log_error "$message"
  return 1
}

deploy_runtime_execute() {
  local prepare_fn="${1:-}"
  local migrate_fn="${2:-}"
  local switch_fn="${3:-}"
  local validate_fn="${4:-}"
  local fault_fn="${5:-}"

  for function_name in "$prepare_fn" "$migrate_fn" "$switch_fn" "$validate_fn"; do
    if [ -z "$function_name" ] || ! declare -f "$function_name" >/dev/null 2>&1; then
      deploy_runtime_executor_log_error "Shared runtime executor adapter function is missing: ${function_name:-unset}"
      return 1
    fi
  done

  if ! "$prepare_fn"; then
    deploy_runtime_executor_fail "Runtime adapter preparation failed"
    return 1
  fi

  if declare -f deployment_transaction_transition >/dev/null 2>&1 &&
    [ "${DEPLOYMENT_PHASE:-}" = "${DEPLOYMENT_PHASE_PREPARED:-PREPARED}" ]; then
    deployment_transaction_transition "${DEPLOYMENT_PHASE_SWITCHING:-SWITCHING}" SWITCH || {
      deploy_runtime_executor_fail 'Unable to cross the deployment mutation boundary'
      return 1
    }
  fi
  if ! "$migrate_fn"; then
    deploy_runtime_executor_fail "Runtime adapter migration failed"
    return 1
  fi
  if ! "$switch_fn"; then
    deploy_runtime_executor_fail "Runtime adapter switch failed"
    return 1
  fi

  if declare -f deployment_transaction_transition >/dev/null 2>&1 &&
    [ "${DEPLOYMENT_PHASE:-}" = "${DEPLOYMENT_PHASE_SWITCHING:-SWITCHING}" ]; then
    deployment_transaction_transition "${DEPLOYMENT_PHASE_ACTIVATED_UNVERIFIED:-ACTIVATED_UNVERIFIED}" SWITCH || {
      deploy_runtime_executor_fail 'Unable to record activated-unverified runtime state'
      return 1
    }
  fi

  if [ -n "$fault_fn" ] && declare -f "$fault_fn" >/dev/null 2>&1; then
    "$fault_fn" || {
      deploy_runtime_executor_fail 'Runtime fault barrier failed'
      return 1
    }
  fi
  deploy_runtime_wait_for_health_and_readiness || {
    deploy_runtime_executor_fail 'Runtime health/readiness verification failed'
    return 1
  }
  "$validate_fn" || {
    deploy_runtime_executor_fail 'Live runtime identity validation failed'
    return 1
  }

  if declare -f deployment_transaction_transition >/dev/null 2>&1 &&
    [ "${DEPLOYMENT_PHASE:-}" = "${DEPLOYMENT_PHASE_ACTIVATED_UNVERIFIED:-ACTIVATED_UNVERIFIED}" ]; then
    deployment_transaction_transition "${DEPLOYMENT_PHASE_VERIFIED:-VERIFIED}" VERIFY || {
      deploy_runtime_executor_fail 'Unable to record verified runtime state'
      return 1
    }
  fi
  if declare -f deployment_state_activate_v2_release >/dev/null 2>&1; then
    FAILURE_POINT=commit-current-activation
    FAILURE_CATEGORY=state-write
    FAILURE_MESSAGE='verified release pointer activation failed'
    export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
    deployment_state_activate_v2_release "${RELEASE_ID:-}" || {
      deploy_runtime_executor_fail 'Unable to activate the verified Release Bundle state'
      return 1
    }
  fi
  if declare -f deployment_state_publish_pending_release >/dev/null 2>&1; then
    FAILURE_POINT=candidate-pointer-update
    FAILURE_MESSAGE='verified pending runtime publication failed'
    export FAILURE_POINT FAILURE_MESSAGE
    deployment_state_publish_pending_release || {
      deploy_runtime_executor_fail 'Unable to publish the verified runtime state'
      return 1
    }
  fi
  if declare -f release_execution_mark_stage >/dev/null 2>&1; then
    FAILURE_POINT=commit-context
    FAILURE_MESSAGE='completed release context persistence failed'
    export FAILURE_POINT FAILURE_MESSAGE
    release_execution_mark_stage completed || {
      deploy_runtime_executor_fail 'Unable to persist the completed release context'
      return 1
    }
  fi
  if declare -f deployment_transaction_transition >/dev/null 2>&1; then
    FAILURE_POINT=commit-state
    FAILURE_MESSAGE='committed transaction persistence failed'
    export FAILURE_POINT FAILURE_MESSAGE
    deployment_transaction_transition "${DEPLOYMENT_PHASE_COMMITTED:-COMMITTED}" COMMIT || {
      deploy_runtime_executor_fail 'Unable to record committed runtime state'
      return 1
    }
  fi
  if ! deploy_runtime_record_terminal COMMITTED "${APP_SHA:-${TARGET_SHA:-}}"; then
    # Runtime verification and current activation are already durable. Record
    # the evidence failure without pretending the previous release is active.
    FAILURE_POINT=terminal-ledger
    FAILURE_CATEGORY=state-write
    FAILURE_MESSAGE='runtime committed but terminal ledger evidence could not be persisted'
    export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
    deployment_transaction_write "${DEPLOYMENT_TRANSACTION_FILE:-}" || true
    return 1
  fi
  return 0
}
