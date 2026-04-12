#!/usr/bin/env bash
# release-state.sh - Helpers for deployment release-state/evidence snapshots
# shellcheck shell=bash

RELEASE_STATE_HELPER_CONTRACT_VERSION=1

release_state_cli_path() {
  local script_source="${BASH_SOURCE[0]:-}"
  local lib_dir=""

  if [ -n "$script_source" ]; then
    lib_dir="$(cd "$(dirname "$script_source")" && pwd)"
  else
    lib_dir="$(pwd)/scripts/lib"
  fi

  printf '%s\n' "$(cd "$lib_dir/.." && pwd)/release-state-cli.mjs"
}

release_state_cli_available() {
  command -v node >/dev/null 2>&1 && [ -f "$(release_state_cli_path)" ]
}

release_state_compat_helper_path() {
  local script_source="${BASH_SOURCE[0]:-}"
  local lib_dir=""

  if [ -n "$script_source" ]; then
    lib_dir="$(cd "$(dirname "$script_source")" && pwd)"
  else
    lib_dir="$(pwd)/scripts/lib"
  fi

  printf '%s\n' "$lib_dir/release-state-compat.sh"
}

release_state_source_compat_helper() {
  local compat_helper_path=""

  compat_helper_path="$(release_state_compat_helper_path)"
  if [ ! -f "$compat_helper_path" ]; then
    log_error "Release state compatibility helper not found: $compat_helper_path"
    return 1
  fi

  # shellcheck disable=SC1090
  source "$compat_helper_path"
}

load_release_state_env() {
  local state_path="$1"

  if [ ! -f "$state_path" ]; then
    log_error "Release state file not found: $state_path"
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$state_path"
  set +a
}

release_state_list_fields() {
  local snapshot_type="$1"

  if release_state_cli_available; then
    node "$(release_state_cli_path)" list-fields --snapshot-type "$snapshot_type"
    return 0
  fi

  release_state_source_compat_helper || return 1
  release_state_list_fields_compat "$snapshot_type"
}

write_release_state_snapshot() {
  local snapshot_type="$1"
  local state_path="$2"
  local field=""
  local value=""
  local -a cli_cmd=()

  if ! release_state_cli_available; then
    release_state_source_compat_helper || return 1
    write_release_state_snapshot_compat "$snapshot_type" "$state_path"
    return 0
  fi

  cli_cmd=(env)

  while IFS= read -r field; do
    [ -z "$field" ] && continue
    value="${!field:-}"
    cli_cmd+=("$field=$value")
  done < <(release_state_list_fields "$snapshot_type")

  cli_cmd+=(
    node
    "$(release_state_cli_path)"
    write-snapshot
    --snapshot-type
    "$snapshot_type"
    --output
    "$state_path"
  )

  "${cli_cmd[@]}"
}

write_current_release_state() {
  local state_path="$1"
  write_release_state_snapshot "current-runtime" "$state_path"
}

write_deploy_context_state() {
  local state_path="$1"
  write_release_state_snapshot "deploy-context" "$state_path"
}

write_staging_verification_state() {
  local state_path="$1"
  write_release_state_snapshot "staging-verification" "$state_path"
}

write_staging_verification_run_state() {
  local state_path="$1"
  write_release_state_snapshot "staging-verification-run" "$state_path"
}

release_state_assert_equal() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if [ "$expected" != "$actual" ]; then
    echo "::error::$label mismatch. expected=$expected actual=$actual"
    return 1
  fi
}

release_state_require_nonempty() {
  local field_name=""

  for field_name in "$@"; do
    if [ -z "${!field_name:-}" ]; then
      echo "::error::$field_name is missing from release-state evidence"
      return 1
    fi
  done

  return 0
}

verify_current_release_state_matches_expected() {
  if [ "${IMAGE_SOURCE:-}" != "release-candidate" ]; then
    echo "::error::Staging is not running release candidate images (IMAGE_SOURCE=${IMAGE_SOURCE:-unset})"
    return 1
  fi

  release_state_assert_equal "Staging APP_SHA" "$EXPECTED_APP_SHA" "${APP_SHA:-}" || return 1
  release_state_assert_equal "Gateway image" "$EXPECTED_GATEWAY_IMAGE" "${CLASSROOMPATH_GATEWAY_IMAGE:-}" || return 1
  release_state_assert_equal "Migrations image" "$EXPECTED_MIGRATIONS_IMAGE" "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" || return 1
  release_state_assert_equal "OpenPath API image" "$EXPECTED_OPENPATH_API_IMAGE" "${OPENPATH_API_IMAGE:-}" || return 1
  release_state_assert_equal "OpenPath version" "$EXPECTED_OPENPATH_VERSION" "${OPENPATH_VERSION:-}" || return 1
  release_state_assert_equal "SPA image" "$EXPECTED_SPA_IMAGE" "${CLASSROOMPATH_SPA_IMAGE:-}" || return 1
  release_state_assert_equal \
    "OpenPath Linux agent version" \
    "$EXPECTED_OPENPATH_LINUX_AGENT_VERSION" \
    "${OPENPATH_LINUX_AGENT_VERSION:-}" || return 1
}

verify_staging_release_evidence_matches_expected() {
  if [ "${STAGING_SMOKE_RESULT:-}" != "success" ]; then
    echo "::error::Staging smoke evidence is missing or failed (STAGING_SMOKE_RESULT=${STAGING_SMOKE_RESULT:-unset})"
    return 1
  fi

  if [ "${STAGING_RELEASE_GATE_RESULT:-}" != "success" ]; then
    echo "::error::Staging release-gate evidence is missing or failed (STAGING_RELEASE_GATE_RESULT=${STAGING_RELEASE_GATE_RESULT:-unset})"
    return 1
  fi

  if [ "${STAGING_VERIFIED_IMAGE_SOURCE:-}" != "release-candidate" ]; then
    echo "::error::Staging verification evidence does not point to release candidate images (STAGING_VERIFIED_IMAGE_SOURCE=${STAGING_VERIFIED_IMAGE_SOURCE:-unset})"
    return 1
  fi

  release_state_assert_equal \
    "Staging verification SHA" \
    "$EXPECTED_APP_SHA" \
    "${STAGING_VERIFIED_APP_SHA:-}" || return 1
  release_state_assert_equal \
    "Verified gateway image" \
    "$EXPECTED_GATEWAY_IMAGE" \
    "${STAGING_VERIFIED_GATEWAY_IMAGE:-}" || return 1
  release_state_assert_equal \
    "Verified migrations image" \
    "$EXPECTED_MIGRATIONS_IMAGE" \
    "${STAGING_VERIFIED_MIGRATIONS_IMAGE:-}" || return 1
  release_state_assert_equal \
    "Verified OpenPath API image" \
    "$EXPECTED_OPENPATH_API_IMAGE" \
    "${STAGING_VERIFIED_OPENPATH_API_IMAGE:-}" || return 1
  release_state_assert_equal \
    "Verified OpenPath version" \
    "$EXPECTED_OPENPATH_VERSION" \
    "${STAGING_VERIFIED_OPENPATH_VERSION:-}" || return 1
  release_state_assert_equal \
    "Verified SPA image" \
    "$EXPECTED_SPA_IMAGE" \
    "${STAGING_VERIFIED_SPA_IMAGE:-}" || return 1
  release_state_assert_equal \
    "Verified OpenPath Linux agent version" \
    "$EXPECTED_OPENPATH_LINUX_AGENT_VERSION" \
    "${STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION:-}" || return 1
}

verify_high_risk_staging_release_evidence() {
  if [ "${STAGING_SMOKE_STATUS:-}" = "PASS_WITH_FALLBACK" ]; then
    echo "::error::PASS_WITH_FALLBACK is not sufficient production evidence for Windows/Firefox delivery changes"
    return 1
  fi

  if [ "${STAGING_WINDOWS_BOOTSTRAP_RESULT:-}" != "success" ]; then
    echo "::error::Windows bootstrap evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_RESULT=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-unset})"
    return 1
  fi

  if [ "${STAGING_FIREFOX_POLICY_RESULT:-}" != "success" ]; then
    echo "::error::Firefox policy evidence is missing or failed (STAGING_FIREFOX_POLICY_RESULT=${STAGING_FIREFOX_POLICY_RESULT:-unset})"
    return 1
  fi

  if [ "${STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS:-}" != "present" ]; then
    echo "::error::Firefox release artifacts were not marked present in staging verification evidence"
    return 1
  fi

  release_state_require_nonempty \
    STAGING_FIREFOX_EXTENSION_ID \
    STAGING_FIREFOX_RELEASE_VERSION \
    STAGING_FIREFOX_METADATA_SHA256 \
    STAGING_FIREFOX_XPI_SHA256
}

emit_staging_release_evidence_outputs() {
  local github_output_path="${1:-${GITHUB_OUTPUT:-}}"

  if [ -z "$github_output_path" ]; then
    return 0
  fi

  {
    printf 'staging_smoke_result=%s\n' "${STAGING_SMOKE_RESULT:-unknown}"
    printf 'staging_smoke_status=%s\n' "${STAGING_SMOKE_STATUS:-unknown}"
    printf 'staging_release_gate_result=%s\n' "${STAGING_RELEASE_GATE_RESULT:-unknown}"
    printf 'staging_windows_bootstrap_result=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_RESULT:-unknown}"
    printf 'staging_firefox_policy_result=%s\n' "${STAGING_FIREFOX_POLICY_RESULT:-unknown}"
    printf 'staging_firefox_extension_id=%s\n' "${STAGING_FIREFOX_EXTENSION_ID:-unknown}"
    printf 'staging_firefox_release_version=%s\n' "${STAGING_FIREFOX_RELEASE_VERSION:-unknown}"
    printf 'staging_firefox_metadata_sha256=%s\n' "${STAGING_FIREFOX_METADATA_SHA256:-unknown}"
    printf 'staging_firefox_xpi_sha256=%s\n' "${STAGING_FIREFOX_XPI_SHA256:-unknown}"
    printf 'staging_verified_at=%s\n' "${STAGING_VERIFIED_AT:-unknown}"
  } >> "$github_output_path"
}
