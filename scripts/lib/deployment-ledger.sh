#!/usr/bin/env bash
# Append-only deployment ledger for terminal release facts.
# shellcheck shell=bash

DEPLOYMENT_LEDGER_CONTRACT_VERSION=1

deployment_ledger_json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

deployment_ledger_valid_sha40() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

deployment_ledger_valid_sha256() {
  [[ "${1:-}" =~ ^[0-9a-f]{64}$ ]]
}

deployment_ledger_validate_inputs() {
  local environment="$1"
  local transaction_id="$2"
  local candidate_sha="$3"
  local release_id="$4"
  local previous_sha="$5"
  local recovery_sha="$6"
  local result="$7"
  local health="$8"
  local ready="$9"
  local workflow_run_id="${10:-}"
  local current_sha="${11:-}"
  local rc_run_id="${12:-}"

  [[ "$environment" =~ ^(staging|production)$ ]] || return 1
  [[ "$transaction_id" =~ ^[A-Za-z0-9._:-]+$ ]] || return 1
  deployment_ledger_valid_sha40 "$candidate_sha" || return 1
  [ -z "$release_id" ] || deployment_ledger_valid_sha256 "$release_id" || return 1
  [ -z "$previous_sha" ] || deployment_ledger_valid_sha40 "$previous_sha" || return 1
  [ -z "$recovery_sha" ] || deployment_ledger_valid_sha40 "$recovery_sha" || return 1
  [[ "$result" =~ ^(COMMITTED|ROLLED_BACK|FAILED)$ ]] || return 1
  [[ "$health" =~ ^[0-9]+$|^$ ]] || return 1
  [[ "$ready" == true || "$ready" == false ]] || return 1
  [ -z "$workflow_run_id" ] || [[ "$workflow_run_id" =~ ^[0-9]+$ ]] || return 1
  [ -z "$current_sha" ] || deployment_ledger_valid_sha40 "$current_sha" || return 1
  [ -z "$rc_run_id" ] || [[ "$rc_run_id" =~ ^[0-9]+$ ]] || return 1
}

deployment_ledger_image_digests_json() {
  local first=1
  local descriptor=""
  local key=""
  local variable_name=""
  local image_ref=""
  local digest=""

  printf '{'
  for descriptor in \
    gateway:CLASSROOMPATH_GATEWAY_IMAGE \
    migrations:CLASSROOMPATH_MIGRATIONS_IMAGE \
    openpathFirefoxAssets:OPENPATH_FIREFOX_ASSETS_IMAGE \
    openpathApi:OPENPATH_API_IMAGE \
    spa:CLASSROOMPATH_SPA_IMAGE \
    verifier:CLASSROOMPATH_VERIFIER_IMAGE; do
    key="${descriptor%%:*}"
    variable_name="${descriptor#*:}"
    image_ref="${!variable_name:-}"
    digest="${image_ref##*@}"
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
    [ "$first" -eq 1 ] || printf ','
    printf '"%s":"%s"' "$key" "$digest"
    first=0
  done
  printf '}'
}

deployment_ledger_build_record() {
  local environment="$1"
  local transaction_id="$2"
  local candidate_sha="$3"
  local release_id="$4"
  local previous_sha="$5"
  local recovery_sha="$6"
  local result="$7"
  local health="$8"
  local ready="$9"
  local workflow_run_id="${10:-}"
  local current_sha="${11:-}"
  local rc_run_id="${12:-}"
  local tag="${13:-}"
  local timestamp="${DEPLOYMENT_LEDGER_TIMESTAMP:-${DEPLOYMENT_PHASE_UPDATED_AT:-}}"
  local openpath_sha="${DEPLOYMENT_LEDGER_OPENPATH_SHA:-${OPENPATH_SHA:-}}"
  local contract_sha256="${DEPLOYMENT_LEDGER_CONTRACT_SHA256:-${OPENPATH_CONTRACT_SHA256:-}}"
  local phase="${DEPLOYMENT_LEDGER_PHASE:-${DEPLOYMENT_PHASE:-}}"
  local rollback_attempted="${DEPLOYMENT_LEDGER_ROLLBACK_ATTEMPTED:-${ROLLBACK_ATTEMPTED:-0}}"
  local rollback_result="${DEPLOYMENT_LEDGER_ROLLBACK_RESULT:-${ROLLBACK_RESULT:-not_attempted}}"
  local image_digests_json=""

  if [ -z "$timestamp" ]; then
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi
  [[ "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
    printf '[ERROR] invalid deployment ledger timestamp\n' >&2
    return 1
  }
  case "$rollback_attempted" in
    1|true) rollback_attempted=true ;;
    0|false) rollback_attempted=false ;;
    *)
      printf '[ERROR] invalid deployment ledger rollback marker\n' >&2
      return 1
      ;;
  esac

  deployment_ledger_validate_inputs \
    "$environment" "$transaction_id" "$candidate_sha" "$release_id" "$previous_sha" \
    "$recovery_sha" "$result" "$health" "$ready" "$workflow_run_id" "$current_sha" "$rc_run_id" || {
    printf '[ERROR] invalid deployment ledger identity or terminal result\n' >&2
    return 1
  }

  local escaped_environment escaped_transaction_id escaped_candidate_sha escaped_release_id
  local escaped_previous_sha escaped_recovery_sha escaped_result escaped_health escaped_ready
  local escaped_workflow_run_id escaped_current_sha escaped_rc_run_id escaped_tag
  local escaped_timestamp escaped_openpath_sha escaped_contract_sha256 escaped_phase escaped_rollback_result
  escaped_environment="$(deployment_ledger_json_escape "$environment")"
  escaped_transaction_id="$(deployment_ledger_json_escape "$transaction_id")"
  escaped_candidate_sha="$(deployment_ledger_json_escape "$candidate_sha")"
  escaped_release_id="$(deployment_ledger_json_escape "$release_id")"
  escaped_previous_sha="$(deployment_ledger_json_escape "$previous_sha")"
  escaped_recovery_sha="$(deployment_ledger_json_escape "$recovery_sha")"
  escaped_result="$(deployment_ledger_json_escape "$result")"
  escaped_health="$(deployment_ledger_json_escape "$health")"
  escaped_ready="$(deployment_ledger_json_escape "$ready")"
  escaped_workflow_run_id="$(deployment_ledger_json_escape "$workflow_run_id")"
  escaped_current_sha="$(deployment_ledger_json_escape "$current_sha")"
  escaped_rc_run_id="$(deployment_ledger_json_escape "$rc_run_id")"
  escaped_tag="$(deployment_ledger_json_escape "$tag")"
  escaped_timestamp="$(deployment_ledger_json_escape "$timestamp")"
  escaped_openpath_sha="$(deployment_ledger_json_escape "$openpath_sha")"
  escaped_contract_sha256="$(deployment_ledger_json_escape "$contract_sha256")"
  escaped_phase="$(deployment_ledger_json_escape "$phase")"
  escaped_rollback_result="$(deployment_ledger_json_escape "$rollback_result")"
  image_digests_json="$(deployment_ledger_image_digests_json)"

  DEPLOYMENT_LEDGER_RECORD_JSON="$(printf '{"timestamp":"%s","environment":"%s","transactionId":"%s","candidateSha":"%s","releaseId":"%s","previous":"%s","recoverySha":"%s","result":"%s","health":%s,"ready":%s,"workflowRunId":"%s","current":"%s","rcRunId":"%s","tag":"%s","openPathSha":"%s","contractSha256":"%s","phase":"%s","rollbackAttempted":%s,"rollbackResult":"%s","imageDigests":%s}' \
    "$escaped_timestamp" "$escaped_environment" "$escaped_transaction_id" "$escaped_candidate_sha" "$escaped_release_id" "$escaped_previous_sha" "$escaped_recovery_sha" "$escaped_result" \
    "${escaped_health:-null}" "$escaped_ready" "$escaped_workflow_run_id" "$escaped_current_sha" \
    "$escaped_rc_run_id" "$escaped_tag" "$escaped_openpath_sha" "$escaped_contract_sha256" \
    "$escaped_phase" "$rollback_attempted" "$escaped_rollback_result" "$image_digests_json")"
  export DEPLOYMENT_LEDGER_RECORD_JSON
}

deployment_ledger_json_field() {
  local record="$1"
  local field="$2"
  printf '%s\n' "$record" | sed -n "s/.*\"$field\":\"\([^\"]*\)\".*/\1/p"
}

deployment_ledger_without_timestamp() {
  printf '%s\n' "$1" | sed -E 's/"timestamp":"[^"]*",//'
}

deployment_ledger_lock_and_append() {
  local ledger_path="$1"
  local record="$2"
  local transaction_id="$3"
  local lock_dir="${ledger_path}.lock"
  local timeout_seconds="${DEPLOYMENT_LEDGER_LOCK_TIMEOUT_SECONDS:-30}"
  local started_at="$(date +%s)"
  local now=""
  local existing=""
  local existing_candidate=""
  local existing_release=""
  local existing_environment=""
  local normalized_record=""
  local normalized_existing=""

  mkdir -p "$(dirname "$ledger_path")"
  while ! mkdir "$lock_dir" 2>/dev/null; do
    now="$(date +%s)"
    if [ $((now - started_at)) -ge "$timeout_seconds" ]; then
      printf '[ERROR] deployment ledger lock timed out\n' >&2
      return 1
    fi
    sleep 0.05
  done
  printf '%s\n' "$$" > "$lock_dir/owner"

  if [ -f "$ledger_path" ]; then
    if grep -Fqx "$record" "$ledger_path"; then
      LEDGER_APPEND_RESULT="idempotent"
      export LEDGER_APPEND_RESULT
      rm -rf "$lock_dir"
      return 0
    fi
    existing="$(grep -F '"transactionId":"' "$ledger_path" | grep -F "\"transactionId\":\"$transaction_id\"" | tail -n 1 || true)"
    if [ -n "$existing" ]; then
      normalized_record="$(deployment_ledger_without_timestamp "$record")"
      normalized_existing="$(deployment_ledger_without_timestamp "$existing")"
      if [ "$normalized_existing" = "$normalized_record" ]; then
        LEDGER_APPEND_RESULT="idempotent"
        export LEDGER_APPEND_RESULT
        rm -rf "$lock_dir"
        return 0
      fi
      existing_candidate="$(deployment_ledger_json_field "$existing" candidateSha)"
      existing_release="$(deployment_ledger_json_field "$existing" releaseId)"
      existing_environment="$(deployment_ledger_json_field "$existing" environment)"
      if [ "$existing_candidate" != "$(deployment_ledger_json_field "$record" candidateSha)" ] ||
        [ "$existing_release" != "$(deployment_ledger_json_field "$record" releaseId)" ] ||
        [ "$existing_environment" != "$(deployment_ledger_json_field "$record" environment)" ]; then
        rm -rf "$lock_dir"
        printf '[ERROR] deployment transaction id is bound to a different identity\n' >&2
        return 1
      fi
    fi
  fi

  printf '%s\n' "$record" >> "$ledger_path"
  LEDGER_APPEND_RESULT="appended"
  export LEDGER_APPEND_RESULT
  rm -rf "$lock_dir"
}

deployment_ledger_append_terminal() {
  local ledger_path="$1"
  shift
  deployment_ledger_build_record "$@"
  deployment_ledger_lock_and_append "$ledger_path" "$DEPLOYMENT_LEDGER_RECORD_JSON" "$2"
}

deployment_ledger_append_terminal_from_env() {
  local ledger_path="${DEPLOYMENT_LEDGER_FILE:-${STATE_DIR:-/srv/classroompath/release-state}/deployment-ledger.jsonl}"
  deployment_ledger_append_terminal \
    "$ledger_path" \
    "${DEPLOYMENT_ENVIRONMENT:-}" \
    "${DEPLOYMENT_TRANSACTION_ID:-}" \
    "${CANDIDATE_SHA:-${APP_SHA:-}}" \
    "${RELEASE_ID:-}" \
    "${PREVIOUS_APP_SHA:-}" \
    "${PRODUCTION_RECOVERY_SHA:-${RECOVERY_SOURCE_SHA:-}}" \
    "${DEPLOYMENT_RESULT:-}" \
    "${DEPLOYMENT_HEALTH_STATUS:-}" \
    "${DEPLOYMENT_READY:-false}" \
    "${GITHUB_RUN_ID:-}" \
    "${DEPLOYMENT_CURRENT_SHA:-${APP_SHA:-}}" \
    "${RC_RUN_ID:-${STAGING_RELEASE_RUN_ID:-}}" \
    "${DEPLOYMENT_TAG:-${GITHUB_REF_NAME:-}}"
}
