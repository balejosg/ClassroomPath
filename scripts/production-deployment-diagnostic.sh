#!/usr/bin/env bash
# production-deployment-diagnostic.sh - bounded, read-only post-switch evidence
# shellcheck shell=bash

set -u

DIAGNOSTIC_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$DIAGNOSTIC_SCRIPT_DIR/lib/production-host-contract.sh" ]; then
  # shellcheck source=lib/production-host-contract.sh
  source "$DIAGNOSTIC_SCRIPT_DIR/lib/production-host-contract.sh"
fi

diagnostic_error() {
  printf '[diagnostic] %s\n' "$*" >&2
}

diagnostic_json_escape() {
  local value="${1:-}"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

diagnostic_state_value() {
  local state_file="$1"
  local field="$2"

  [ -f "$state_file" ] || return 1
  awk -F= -v expected_field="$field" \
    '$1 == expected_field { print substr($0, index($0, "=") + 1); exit }' "$state_file"
}

diagnostic_pointer_value() {
  local pointer_file="$1"
  local pointer=""

  [ -s "$pointer_file" ] || return 1
  pointer="$(tr -d '\r\n' < "$pointer_file")"
  [[ "$pointer" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$pointer"
}

diagnostic_runtime_value() {
  local runtime_file="$1"
  local field="$2"

  [ -f "$runtime_file" ] || return 1
  awk -F= -v expected_field="$field" \
    '$1 == expected_field { print substr($0, index($0, "=") + 1); exit }' "$runtime_file"
}

diagnostic_safe_body() {
  local body_file="$1"
  local body=""

  [ -f "$body_file" ] || return 0
  body="$(sed -n '1,80p' "$body_file" 2>/dev/null || true)"
  body="${body:0:2048}"
  diagnostic_json_escape "$body"
}

diagnostic_http_probe() {
  local url="$1"
  local label="$2"
  local output_dir="$3"
  local body_file="$output_dir/$label.body"
  local status="000"
  local curl_result=0

  status="$(curl -sS --max-time "${PRODUCTION_DIAGNOSTIC_CURL_TIMEOUT_SECONDS:-5}" \
    --max-filesize "${PRODUCTION_DIAGNOSTIC_MAX_RESPONSE_BYTES:-16384}" \
    -o "$body_file" -w '%{http_code}' "$url" 2>/dev/null)" || curl_result=$?
  if ! [[ "$status" =~ ^[0-9]{3}$ ]]; then status="000"; fi

  printf '{"url":"%s","httpStatus":"%s","curlExit":%s,"body":"%s"}' \
    "$(diagnostic_json_escape "$url")" \
    "$status" \
    "$curl_result" \
    "$(diagnostic_safe_body "$body_file")"
}

production_deployment_diagnostic_run() {
  local deploy_root="${CLASSROOMPATH_DEPLOY_ROOT:-}"
  local state_dir="${deploy_root%/}/release-state"
  local transaction_file="$state_dir/deployment-phase.env"
  local current_pointer="$state_dir/current"
  local previous_pointer="$state_dir/previous"
  local output_file="${PRODUCTION_DIAGNOSTIC_OUTPUT:-$state_dir/post-switch-diagnostic.json}"
  local output_dir=""
  local current_release_id=""
  local previous_release_id=""
  local candidate_release_id=""
  local requested_release_id=""
  local phase=""
  local stage=""
  local mutation_boundary="0"
  local failure_point=""
  local failure_category=""
  local rollback_phase=""
  local rollback_result=""
  local rollback_attempted="0"
  local target_url="${PRODUCTION_DIAGNOSTIC_BASE_URL:-http://localhost:3001}"
  local api_url="${PRODUCTION_DIAGNOSTIC_API_HEALTH_URL:-${target_url%/}/api/health}"
  local health_json='{"status":"not-run"}'
  local ready_json='{"status":"not-run"}'
  local api_health_json='{"status":"not-run"}'
  local containers_json='[]'
  local checked_out_sha=""
  local checked_out_openpath_sha=""
  local current_runtime_file=""
  local pending_runtime_file=""
  local tmp_file=""

  if [ -z "$deploy_root" ] || [ ! -d "$state_dir" ]; then
    diagnostic_error "deployment root/state directory is unavailable"
    return 1
  fi

  output_dir="$(mktemp -d)" || return 1
  current_release_id="$(diagnostic_pointer_value "$current_pointer" || true)"
  previous_release_id="$(diagnostic_pointer_value "$previous_pointer" || true)"
  phase="$(diagnostic_state_value "$transaction_file" DEPLOYMENT_PHASE || true)"
  stage="$(diagnostic_state_value "$transaction_file" DEPLOYMENT_STAGE || true)"
  mutation_boundary="$(diagnostic_state_value "$transaction_file" MUTATION_BOUNDARY_REACHED || true)"
  requested_release_id="$(diagnostic_state_value "$transaction_file" REQUESTED_RELEASE_ID || true)"
  candidate_release_id="$(diagnostic_state_value "$transaction_file" CANDIDATE_RELEASE_ID || true)"
  failure_point="$(diagnostic_state_value "$transaction_file" FAILURE_POINT || true)"
  failure_category="$(diagnostic_state_value "$transaction_file" FAILURE_CATEGORY || true)"
  rollback_phase="$(diagnostic_state_value "$transaction_file" ROLLBACK_PHASE || true)"
  rollback_result="$(diagnostic_state_value "$transaction_file" ROLLBACK_RESULT || true)"
  rollback_attempted="$(diagnostic_state_value "$transaction_file" ROLLBACK_ATTEMPTED || true)"

  if [ "$mutation_boundary" = "1" ]; then
    if [ -n "$current_release_id" ]; then
      current_runtime_file="$state_dir/releases/$current_release_id/runtime.env"
    fi
    if [ -n "$candidate_release_id" ]; then
      pending_runtime_file="$state_dir/releases/$candidate_release_id/runtime.env"
    fi

    health_json="$(diagnostic_http_probe "${target_url%/}/cp/health" health "$output_dir")"
    ready_json="$(diagnostic_http_probe "${target_url%/}/cp/ready" ready "$output_dir")"
    api_health_json="$(diagnostic_http_probe "$api_url" api-health "$output_dir")"

    if production_host_contract_command_available docker 2>/dev/null; then
      containers_json="$(docker ps --all --format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null |
        awk -F'|' 'NR <= 32 { if (count++) printf ","; printf "{\"name\":\"%s\",\"image\":\"%s\",\"status\":\"%s\"}", $1, $2, $3 } END { if (!count) printf "" }' || printf '')"
      [ -n "$containers_json" ] || containers_json='[]'
      [ "$containers_json" = '[]' ] || containers_json="[$containers_json]"
    fi

    checked_out_sha="$(git -C "$deploy_root/app" rev-parse HEAD 2>/dev/null || true)"
    checked_out_openpath_sha="$(git -C "$deploy_root/app" rev-parse HEAD:upstream/openpath 2>/dev/null || true)"
  fi

  tmp_file="$(mktemp "$output_file.tmp.XXXXXX")" || {
    rm -rf "$output_dir"
    return 1
  }
  {
    printf '{\n'
    printf '  "schemaVersion":1,\n'
    printf '  "mode":"%s",\n' "$(if [ "$mutation_boundary" = "1" ]; then printf failure-diagnostic; else printf pre-switch-diagnostic; fi)"
    printf '  "requestedReleaseId":"%s",\n' "$(diagnostic_json_escape "$requested_release_id")"
    printf '  "currentReleaseId":"%s",\n' "$(diagnostic_json_escape "$current_release_id")"
    printf '  "candidateReleaseId":"%s",\n' "$(diagnostic_json_escape "$candidate_release_id")"
    printf '  "previousReleaseId":"%s",\n' "$(diagnostic_json_escape "$previous_release_id")"
    printf '  "deploymentPhase":"%s",\n' "$(diagnostic_json_escape "$phase")"
    printf '  "deploymentStage":"%s",\n' "$(diagnostic_json_escape "$stage")"
    printf '  "mutation_boundary_reached":%s,\n' "$(if [ "$mutation_boundary" = "1" ]; then printf true; else printf false; fi)"
    printf '  "failurePoint":"%s",\n' "$(diagnostic_json_escape "$failure_point")"
    printf '  "failureCategory":"%s",\n' "$(diagnostic_json_escape "$failure_category")"
    printf '  "rollbackPhase":"%s",\n' "$(diagnostic_json_escape "$rollback_phase")"
    printf '  "rollbackAttempted":%s,\n' "$(if [ "$rollback_attempted" = "1" ]; then printf true; else printf false; fi)"
    printf '  "rollbackResult":"%s",\n' "$(diagnostic_json_escape "$rollback_result")"
    printf '  "containerIdentities":%s,\n' "$containers_json"
    printf '  "health":%s,\n' "$health_json"
    printf '  "readiness":%s,\n' "$ready_json"
    printf '  "apiHealth":%s,\n' "$api_health_json"
    printf '  "checkedOutClassroomPathSha":"%s",\n' "$(diagnostic_json_escape "$checked_out_sha")"
    printf '  "checkedOutOpenPathSha":"%s",\n' "$(diagnostic_json_escape "$checked_out_openpath_sha")"
    printf '  "currentRuntimeAvailable":%s,\n' "$(if [ -s "$current_runtime_file" ]; then printf true; else printf false; fi)"
    printf '  "candidateRuntimeAvailable":%s\n' "$(if [ -s "$pending_runtime_file" ]; then printf true; else printf false; fi)"
    printf '}\n'
  } > "$tmp_file"
  install -m 600 "$tmp_file" "$output_file"
  rm -f "$tmp_file"
  rm -rf "$output_dir"
  printf '%s\n' "$output_file"
}

if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  production_deployment_diagnostic_run
fi
