#!/usr/bin/env bash
# production-deployment-diagnostic-fallback.sh - stable minimal post-switch evidence
#
# This file is transmitted by the runner and deliberately has no dependency on
# the checked-out application tree. It is the last diagnostic writer when the
# candidate diagnostic is missing, broken, or reports a stale mutation marker.

set -u

if [ "$#" -ne 2 ]; then
  printf 'Usage: %s <deployment-phase.env> <output.json>\n' "$0" >&2
  exit 2
fi

state_file="$1"
output_file="$2"

fallback_state_value() {
  local field="$1"

  [ -f "$state_file" ] || return 1
  awk -F= -v expected_field="$field" \
    '$1 == expected_field { print substr($0, index($0, "=") + 1); exit }' \
    "$state_file"
}

fallback_json_escape() {
  local value="${1:-}"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

phase="$(fallback_state_value DEPLOYMENT_PHASE || true)"
stage="$(fallback_state_value DEPLOYMENT_STAGE || true)"
marker="$(fallback_state_value MUTATION_BOUNDARY_REACHED || true)"
failure_point="$(fallback_state_value FAILURE_POINT || true)"
failure_category="$(fallback_state_value FAILURE_CATEGORY || true)"
rollback_phase="$(fallback_state_value ROLLBACK_PHASE || true)"
rollback_attempted="$(fallback_state_value ROLLBACK_ATTEMPTED || true)"
rollback_result="$(fallback_state_value ROLLBACK_RESULT || true)"
requested_release_id="$(fallback_state_value REQUESTED_RELEASE_ID || true)"
current_release_id="$(fallback_state_value CURRENT_RELEASE_ID || true)"
candidate_release_id="$(fallback_state_value CANDIDATE_RELEASE_ID || true)"
previous_release_id="$(fallback_state_value PREVIOUS_RELEASE_ID || true)"

if [ "${marker:-}" = "1" ]; then
  mutation_boundary_reached=true
else
  mutation_boundary_reached=false
fi

tmp_file="$(mktemp "$output_file.tmp.XXXXXX")" || exit 1
{
  printf '{\n'
  printf '  "schemaVersion":1,\n'
  printf '  "mode":"minimal-post-switch-diagnostic",\n'
  printf '  "requestedReleaseId":"%s",\n' "$(fallback_json_escape "$requested_release_id")"
  printf '  "currentReleaseId":"%s",\n' "$(fallback_json_escape "$current_release_id")"
  printf '  "candidateReleaseId":"%s",\n' "$(fallback_json_escape "$candidate_release_id")"
  printf '  "previousReleaseId":"%s",\n' "$(fallback_json_escape "$previous_release_id")"
  printf '  "deploymentPhase":"%s",\n' "$(fallback_json_escape "$phase")"
  printf '  "deploymentStage":"%s",\n' "$(fallback_json_escape "$stage")"
  printf '  "mutation_boundary_reached":%s,\n' "$mutation_boundary_reached"
  printf '  "mutationBoundaryMarker":"%s",\n' "$(fallback_json_escape "$marker")"
  printf '  "failurePoint":"%s",\n' "$(fallback_json_escape "$failure_point")"
  printf '  "failureCategory":"%s",\n' "$(fallback_json_escape "$failure_category")"
  printf '  "rollbackPhase":"%s",\n' "$(fallback_json_escape "$rollback_phase")"
  printf '  "rollbackAttempted":%s,\n' "$(if [ "${rollback_attempted:-}" = 1 ]; then printf true; else printf false; fi)"
  printf '  "rollbackResult":"%s"\n' "$(fallback_json_escape "$rollback_result")"
  printf '}\n'
} > "$tmp_file" || {
  rm -f "$tmp_file"
  exit 1
}

install -m 600 "$tmp_file" "$output_file"
rm -f "$tmp_file"
