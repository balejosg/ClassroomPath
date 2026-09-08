#!/usr/bin/env bash
# Append-only deployment ledger for terminal release facts.
# shellcheck shell=bash

# shellcheck disable=SC2034 # sourced helper contract is consumed by callers.
DEPLOYMENT_LEDGER_CONTRACT_VERSION=1
DEPLOYMENT_LEDGER_MAX_RECORD_BYTES=8192
DEPLOYMENT_LEDGER_MAX_TRANSACTION_ID_LENGTH=128
DEPLOYMENT_LEDGER_MAX_TAG_LENGTH=128
DEPLOYMENT_LEDGER_MAX_NUMERIC_ID_LENGTH=20

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

deployment_ledger_valid_tag() {
  local value="${1:-}"

  [ -z "$value" ] || {
    [ "${#value}" -le "$DEPLOYMENT_LEDGER_MAX_TAG_LENGTH" ] || return 1
    [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || return 1
  }
}

deployment_ledger_valid_health() {
  case "${1:-}" in
    ''|0|[1-9]|[1-9][0-9]|[1-9][0-9][0-9])
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

deployment_ledger_valid_phase() {
  case "${1:-}" in
    ''|PREPARED|SWITCHING|ACTIVATED_UNVERIFIED|VERIFIED|COMMITTED|ROLLING_BACK|ROLLED_BACK|FAILED)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

deployment_ledger_valid_rollback_result() {
  [[ "${1:-}" =~ ^(not_attempted|success|failed|running|unavailable|NOT_REQUIRED)$ ]]
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
  local tag="${13:-}"
  local openpath_sha="${14:-}"
  local contract_sha256="${15:-}"
  local phase="${16:-}"
  local rollback_result="${17:-}"

  [[ "$environment" =~ ^(staging|production)$ ]] || return 1
  [ -n "$transaction_id" ] || return 1
  [ "${#transaction_id}" -le "$DEPLOYMENT_LEDGER_MAX_TRANSACTION_ID_LENGTH" ] || return 1
  [[ "$transaction_id" =~ ^[A-Za-z0-9._:-]+$ ]] || return 1
  deployment_ledger_valid_sha40 "$candidate_sha" || return 1
  [ -z "$release_id" ] || deployment_ledger_valid_sha256 "$release_id" || return 1
  [ -z "$previous_sha" ] || deployment_ledger_valid_sha40 "$previous_sha" || return 1
  [ -z "$recovery_sha" ] || deployment_ledger_valid_sha40 "$recovery_sha" || return 1
  [[ "$result" =~ ^(COMMITTED|ROLLED_BACK|FAILED)$ ]] || return 1
  deployment_ledger_valid_health "$health" || return 1
  [[ "$ready" == true || "$ready" == false ]] || return 1
  [ -z "$workflow_run_id" ] || {
    [ "${#workflow_run_id}" -le "$DEPLOYMENT_LEDGER_MAX_NUMERIC_ID_LENGTH" ] || return 1
    [[ "$workflow_run_id" =~ ^[0-9]+$ ]] || return 1
  }
  [ -z "$current_sha" ] || deployment_ledger_valid_sha40 "$current_sha" || return 1
  [ -z "$rc_run_id" ] || {
    [ "${#rc_run_id}" -le "$DEPLOYMENT_LEDGER_MAX_NUMERIC_ID_LENGTH" ] || return 1
    [[ "$rc_run_id" =~ ^[0-9]+$ ]] || return 1
  }
  deployment_ledger_valid_tag "$tag" || return 1
  [ -z "$openpath_sha" ] || deployment_ledger_valid_sha40 "$openpath_sha" || return 1
  [ -z "$contract_sha256" ] || deployment_ledger_valid_sha256 "$contract_sha256" || return 1
  deployment_ledger_valid_phase "$phase" || return 1
  deployment_ledger_valid_rollback_result "$rollback_result" || return 1
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
  local mutation_boundary="${MUTATION_BOUNDARY_REACHED:-0}"
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

  case "$mutation_boundary" in
    0|1) ;;
    *)
      printf '[ERROR] invalid deployment ledger mutation boundary marker\n' >&2
      return 1
      ;;
  esac

  case "$health" in
    00|000) health=0 ;;
  esac

  case "$result" in
    COMMITTED)
      if [ "$mutation_boundary" != 1 ] || [ "$phase" != COMMITTED ]; then
        printf '[ERROR] committed deployment requires mutation boundary and COMMITTED phase\n' >&2
        return 1
      fi
      [ -n "$current_sha" ] || current_sha="$candidate_sha"
      [ "$current_sha" = "$candidate_sha" ] || {
        printf '[ERROR] committed deployment current identity differs from candidate\n' >&2
        return 1
      }
      ;;
    ROLLED_BACK)
      [ -n "$previous_sha" ] || {
        printf '[ERROR] rolled back deployment requires previous identity\n' >&2
        return 1
      }
      if [ "$mutation_boundary" != 1 ] || [ "$phase" != ROLLED_BACK ]; then
        printf '[ERROR] rolled back deployment requires mutation boundary and ROLLED_BACK phase\n' >&2
        return 1
      fi
      if [ "$environment" = production ]; then
        [ -n "$recovery_sha" ] || {
          printf '[ERROR] production rollback requires recovery identity\n' >&2
          return 1
        }
      fi
      if [ -n "$recovery_sha" ] && [ "$recovery_sha" = "$candidate_sha" ]; then
        printf '[ERROR] recovery identity must differ from candidate\n' >&2
        return 1
      fi
      if [ "$rollback_attempted" != true ] || [ "$rollback_result" != success ]; then
        printf '[ERROR] rolled back deployment requires a successful rollback\n' >&2
        return 1
      fi
      current_sha="$previous_sha"
      ;;
    FAILED)
      # A failed marker write can leave the last nonterminal phase visible.
      # Preserve that observation, but never contradict a successful terminal
      # phase merely because post-commit evidence could not be persisted.
      if [ "$phase" = COMMITTED ] || [ "$phase" = ROLLED_BACK ]; then
        printf '[ERROR] failed deployment contradicts a successful terminal phase\n' >&2
        return 1
      fi
      if [ "$mutation_boundary" = 0 ]; then
        [ "$phase" = FAILED ] || {
          printf '[ERROR] pre-boundary failure requires FAILED phase\n' >&2
          return 1
        }
        if [ "$rollback_attempted" != false ] || [ "$rollback_result" != not_attempted ]; then
          printf '[ERROR] pre-boundary failure cannot claim rollback\n' >&2
          return 1
        fi
        current_sha="$previous_sha"
      fi
      ;;
  esac

  deployment_ledger_validate_inputs \
    "$environment" "$transaction_id" "$candidate_sha" "$release_id" "$previous_sha" \
    "$recovery_sha" "$result" "$health" "$ready" "$workflow_run_id" "$current_sha" "$rc_run_id" \
    "$tag" "$openpath_sha" "$contract_sha256" "$phase" "$rollback_result" || {
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
  [ "${#DEPLOYMENT_LEDGER_RECORD_JSON}" -le "$DEPLOYMENT_LEDGER_MAX_RECORD_BYTES" ] || {
    printf '[ERROR] deployment ledger record exceeds the safe size limit\n' >&2
    return 1
  }
  export DEPLOYMENT_LEDGER_RECORD_JSON
}

deployment_ledger_json_field() {
  local record="$1"
  local field="$2"
  printf '%s\n' "$record" | sed -n "s/.*\"$field\":\"\([^\"]*\)\".*/\1/p"
}

deployment_ledger_image_digests_field() {
  local record="$1"
  local first=1
  local key=""
  local digest=""

  # Re-emit the allowlisted image keys in the same order as the builder so
  # identity comparison is semantic rather than dependent on JSON key order.
  printf '{'
  for key in gateway migrations openpathFirefoxAssets openpathApi spa verifier; do
    digest="$(printf '%s\n' "$record" | sed -n -E "s/.*\"imageDigests\":\{[^}]*\"${key}\":\"(sha256:[0-9a-f]{64})\"[^}]*\}.*/\1/p")"
    [ -n "$digest" ] || continue
    [ "$first" -eq 1 ] || printf ','
    printf '"%s":"%s"' "$key" "$digest"
    first=0
  done
  printf '}'
}

deployment_ledger_release_lock() {
  local lock_dir="$1"

  rm -f "$lock_dir/owner" 2>/dev/null || return 1
  rmdir "$lock_dir" 2>/dev/null
}

deployment_ledger_release_lock_with_warning() {
  local lock_dir="$1"

  if ! deployment_ledger_release_lock "$lock_dir"; then
    printf '[ERROR] deployment ledger lock cleanup failed\n' >&2
  fi
}

deployment_ledger_sync_file() {
  local ledger_path="$1"

  # Remote staging/production hosts use Linux coreutils; -d flushes the file
  # data without pretending a successful append is durable when sync fails.
  command -v sync >/dev/null 2>&1 || {
    printf '[ERROR] sync command is unavailable for deployment ledger\n' >&2
    return 1
  }
  if ! sync -d "$ledger_path" >/dev/null 2>&1; then
    printf '[ERROR] deployment ledger durable flush failed\n' >&2
    return 1
  fi
}

deployment_ledger_mark_idempotent() {
  local ledger_path="$1"
  local lock_dir="$2"

  if ! deployment_ledger_sync_file "$ledger_path"; then
    deployment_ledger_release_lock_with_warning "$lock_dir"
    return 1
  fi
  LEDGER_APPEND_RESULT="idempotent"
  export LEDGER_APPEND_RESULT
  deployment_ledger_release_lock "$lock_dir"
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
  local started_at=""
  local now=""
  local existing=""
  local normalized_record=""
  local normalized_existing=""
  local identity_field=""
  local existing_identity_value=""
  local record_identity_value=""

  [ -n "$record" ] || {
    printf '[ERROR] empty deployment ledger record\n' >&2
    return 1
  }

  started_at="$(date +%s)"

  if ! mkdir -p "$(dirname "$ledger_path")"; then
    printf '[ERROR] deployment ledger directory creation failed\n' >&2
    return 1
  fi
  while ! mkdir "$lock_dir" 2>/dev/null; do
    now="$(date +%s)"
    if [ $((now - started_at)) -ge "$timeout_seconds" ]; then
      printf '[ERROR] deployment ledger lock timed out\n' >&2
      return 1
    fi
    sleep 0.05
  done
  if ! printf '%s\n' "$$" > "$lock_dir/owner"; then
    deployment_ledger_release_lock_with_warning "$lock_dir"
    printf '[ERROR] deployment ledger lock owner write failed\n' >&2
    return 1
  fi

  if [ -f "$ledger_path" ]; then
    if grep -Fqx "$record" "$ledger_path"; then
      deployment_ledger_mark_idempotent "$ledger_path" "$lock_dir"
      return $?
    fi
    existing="$(grep -F '"transactionId":"' "$ledger_path" | grep -F "\"transactionId\":\"$transaction_id\"" | tail -n 1 || true)"
    if [ -n "$existing" ]; then
      normalized_record="$(deployment_ledger_without_timestamp "$record")"
      normalized_existing="$(deployment_ledger_without_timestamp "$existing")"
      if [ "$normalized_existing" = "$normalized_record" ]; then
        deployment_ledger_mark_idempotent "$ledger_path" "$lock_dir"
        return $?
      fi
      for identity_field in \
        environment candidateSha releaseId previous recoverySha workflowRunId rcRunId tag openPathSha contractSha256 imageDigests; do
        if [ "$identity_field" = imageDigests ]; then
          existing_identity_value="$(deployment_ledger_image_digests_field "$existing")"
          record_identity_value="$(deployment_ledger_image_digests_field "$record")"
        else
          existing_identity_value="$(deployment_ledger_json_field "$existing" "$identity_field")"
          record_identity_value="$(deployment_ledger_json_field "$record" "$identity_field")"
        fi
        if [ "$existing_identity_value" != "$record_identity_value" ]; then
          deployment_ledger_release_lock_with_warning "$lock_dir"
          printf '[ERROR] deployment transaction id is bound to a different identity\n' >&2
          return 1
        fi
      done
    fi
  fi

  if ! printf '%s\n' "$record" >> "$ledger_path"; then
    deployment_ledger_release_lock_with_warning "$lock_dir"
    printf '[ERROR] deployment ledger append failed\n' >&2
    return 1
  fi
  if ! deployment_ledger_sync_file "$ledger_path"; then
    deployment_ledger_release_lock_with_warning "$lock_dir"
    return 1
  fi
  LEDGER_APPEND_RESULT="appended"
  export LEDGER_APPEND_RESULT
  deployment_ledger_release_lock "$lock_dir"
}

deployment_ledger_append_terminal() {
  local ledger_path="$1"
  shift
  DEPLOYMENT_LEDGER_RECORD_JSON=""
  export DEPLOYMENT_LEDGER_RECORD_JSON
  deployment_ledger_build_record "$@" || return 1
  [ -n "$DEPLOYMENT_LEDGER_RECORD_JSON" ] || {
    printf '[ERROR] deployment ledger build returned an empty record\n' >&2
    return 1
  }
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
