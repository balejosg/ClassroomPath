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

  case "$snapshot_type" in
    current-runtime)
      cat <<'EOF'
APP_SHA
IMAGE_SOURCE
CLASSROOMPATH_GATEWAY_IMAGE
CLASSROOMPATH_MIGRATIONS_IMAGE
OPENPATH_FIREFOX_ASSETS_IMAGE
OPENPATH_API_IMAGE
OPENPATH_VERSION
OPENPATH_LINUX_AGENT_VERSION
CLASSROOMPATH_SPA_IMAGE
EOF
      ;;
    deploy-context)
      cat <<'EOF'
TARGET_SHA
APP_SHA
PREVIOUS_APP_SHA
IMAGE_SOURCE
MIGRATION_RISK_LEVEL
MIGRATION_CHANGED_FILES
MIGRATION_DESTRUCTIVE_FILES
MIGRATION_EXPAND_FILES
MIGRATION_SAFE_FILES
PRODUCTION_BACKUP_REFERENCE
DB_MIGRATED
FAILURE_STAGE
DEPLOY_FAILURE_STAGE
ROLLBACK_ATTEMPTED
ROLLBACK_RESULT
EOF
      ;;
    staging-verification)
      cat <<'EOF'
STAGING_VERIFICATION_STATE
STAGING_EXPECTED_APP_SHA
STAGING_EXPECTED_OPENPATH_SHA
STAGING_EXPECTED_IMAGE_SOURCE
STAGING_VERIFICATION_STARTED_AT
STAGING_VERIFIED_AT
STAGING_VERIFIED_BY
STAGING_VERIFIED_APP_SHA
STAGING_VERIFIED_OPENPATH_SHA
STAGING_VERIFIED_IMAGE_SOURCE
STAGING_VERIFIED_GATEWAY_IMAGE
STAGING_VERIFIED_MIGRATIONS_IMAGE
STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE
STAGING_VERIFIED_OPENPATH_API_IMAGE
STAGING_VERIFIED_OPENPATH_VERSION
STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION
STAGING_VERIFIED_SPA_IMAGE
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS
STAGING_WINDOWS_FIREFOX_HIGH_RISK
STAGING_SMOKE_RESULT
STAGING_SMOKE_STATUS
STAGING_RELEASE_GATE_RESULT
STAGING_ENROLLMENT_DOWNLOAD_RESULT
STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT
STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT
STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT
STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT
STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA
STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID
STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID
STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE
STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_SIGNATURE_SOURCE
STAGING_FIREFOX_SIGNATURE_STATE
STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256
EOF
      ;;
    staging-verification-run)
      cat <<'EOF'
SMOKE_TARGET_URL
SMOKE_SKIP_CORS
STAGING_SMOKE_RESULT
STAGING_SMOKE_STATUS
RELEASE_GATE_TARGET_URL
RELEASE_GATE_EXPECTED_ORIGIN
STAGING_RELEASE_GATE_RESULT
STAGING_ENROLLMENT_DOWNLOAD_RESULT
STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT
STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT
STAGING_VERIFIED_AT
STAGING_WINDOWS_FIREFOX_HIGH_RISK
STAGING_FIREFOX_RELEASE_ARTIFACTS
STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT
STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT
STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA
STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID
STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID
STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE
STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_SIGNATURE_SOURCE
STAGING_FIREFOX_SIGNATURE_STATE
STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256
EOF
      ;;
    *)
      log_error "Unknown release state snapshot type: $snapshot_type"
      return 1
      ;;
  esac
}

write_release_state_snapshot() {
  local snapshot_type="$1"
  local state_path="$2"
  local field=""
  local value=""
  local -a cli_cmd=()

  if release_state_cli_available; then
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
    return 0
  fi

  mkdir -p "$(dirname "$state_path")"
  : > "$state_path"

  while IFS= read -r field; do
    [ -z "$field" ] && continue
    value="${!field:-}"
    printf '%s=%q\n' "$field" "$value" >> "$state_path"
  done < <(release_state_list_fields "$snapshot_type")
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

write_staging_verification_pending_state() {
  local state_path="$1"
  local app_sha="$2"
  local openpath_sha="$3"
  local image_source="$4"
  local started_at=""

  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  STAGING_VERIFICATION_STATE="pending" \
  STAGING_EXPECTED_APP_SHA="$app_sha" \
  STAGING_EXPECTED_OPENPATH_SHA="$openpath_sha" \
  STAGING_EXPECTED_IMAGE_SOURCE="$image_source" \
  STAGING_VERIFICATION_STARTED_AT="$started_at" \
  STAGING_VERIFIED_AT="" \
  STAGING_VERIFIED_BY="" \
  STAGING_VERIFIED_APP_SHA="" \
  STAGING_VERIFIED_OPENPATH_SHA="" \
  STAGING_VERIFIED_IMAGE_SOURCE="" \
  STAGING_VERIFIED_GATEWAY_IMAGE="" \
  STAGING_VERIFIED_MIGRATIONS_IMAGE="" \
  STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE="" \
  STAGING_VERIFIED_OPENPATH_API_IMAGE="" \
  STAGING_VERIFIED_OPENPATH_VERSION="" \
  STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION="" \
  STAGING_VERIFIED_SPA_IMAGE="" \
  STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS="" \
  STAGING_EMAIL_PREFLIGHT_MODE="" \
  STAGING_EMAIL_DELIVERY_HIGH_RISK="" \
  STAGING_EMAIL_PREFLIGHT_RESULT="" \
  STAGING_EMAIL_PREFLIGHT_PROVIDER="" \
  STAGING_WINDOWS_FIREFOX_HIGH_RISK="" \
  STAGING_SMOKE_RESULT="pending" \
  STAGING_SMOKE_STATUS="pending" \
  STAGING_RELEASE_GATE_RESULT="pending" \
  STAGING_ENROLLMENT_DOWNLOAD_RESULT="pending" \
  STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT="pending" \
  STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT="pending" \
  STAGING_WINDOWS_BOOTSTRAP_RESULT="pending" \
  STAGING_FIREFOX_POLICY_RESULT="pending" \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT="" \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA="" \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID="" \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID="" \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE="" \
  STAGING_FIREFOX_EXTENSION_ID="" \
  STAGING_FIREFOX_RELEASE_VERSION="" \
  STAGING_FIREFOX_SIGNATURE_SOURCE="" \
  STAGING_FIREFOX_SIGNATURE_STATE="" \
  STAGING_FIREFOX_METADATA_SHA256="" \
  STAGING_FIREFOX_XPI_SHA256="" \
  STAGING_LINUX_BOOTSTRAP_RESULT="pending" \
  STAGING_LINUX_BOOTSTRAP_RUN_ID="" \
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID="" \
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE="" \
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
  release_state_assert_equal "OpenPath Firefox assets image" "$EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE" "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" || return 1
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

  if [ "${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-}" != "success" ] ||
    [ "${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-}" != "success" ] ||
    [ "${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-}" != "success" ]; then
    echo "::error::Enrollment download evidence is missing or failed (STAGING_ENROLLMENT_DOWNLOAD_RESULT=${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-unset}; STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT=${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-unset}; STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT=${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-unset})"
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
    "Verified OpenPath Firefox assets image" \
    "$EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE" \
    "${STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE:-}" || return 1
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
    echo "::error::Windows download/bootstrap-assets evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_RESULT=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-unset})"
    return 1
  fi

  if [ "${STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT:-}" != "success" ]; then
    echo "::error::Windows runtime bootstrap canary evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=${STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT:-unset})"
    return 1
  fi

  if [ -z "${STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA:-}" ] || [ "${STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA:-}" != "${STAGING_VERIFIED_APP_SHA:-}" ]; then
    echo "::error::Windows runtime bootstrap canary evidence is not fresh for staged APP_SHA (STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA=${STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA:-unset}; STAGING_VERIFIED_APP_SHA=${STAGING_VERIFIED_APP_SHA:-unset})"
    return 1
  fi

  if [ "${STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID:-}" != "none" ]; then
    echo "::error::Windows runtime bootstrap canary did not reach firefox-extension-ready successfully (STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID=${STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID:-unset})"
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
    STAGING_FIREFOX_SIGNATURE_SOURCE \
    STAGING_FIREFOX_SIGNATURE_STATE \
    STAGING_FIREFOX_METADATA_SHA256 \
    STAGING_FIREFOX_XPI_SHA256

  if [ "${STAGING_FIREFOX_SIGNATURE_SOURCE:-}" != "amo" ]; then
    echo "::error::STAGING_FIREFOX_SIGNATURE_SOURCE must be amo (actual=${STAGING_FIREFOX_SIGNATURE_SOURCE:-unset})"
    return 1
  fi

  if [ "${STAGING_FIREFOX_SIGNATURE_STATE:-}" != "signed" ]; then
    echo "::error::STAGING_FIREFOX_SIGNATURE_STATE must be signed (actual=${STAGING_FIREFOX_SIGNATURE_STATE:-unset})"
    return 1
  fi
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
    printf 'staging_enrollment_download_result=%s\n' "${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-unknown}"
    printf 'staging_linux_enrollment_script_result=%s\n' "${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-unknown}"
    printf 'staging_windows_enrollment_script_result=%s\n' "${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-unknown}"
    printf 'staging_windows_bootstrap_result=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_RESULT:-unknown}"
    printf 'staging_firefox_policy_result=%s\n' "${STAGING_FIREFOX_POLICY_RESULT:-unknown}"
    printf 'staging_windows_bootstrap_canary_result=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT:-unknown}"
    printf 'staging_windows_bootstrap_canary_app_sha=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA:-unknown}"
    printf 'staging_windows_bootstrap_canary_run_id=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID:-unknown}"
    printf 'staging_windows_bootstrap_canary_failure_boundary_id=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID:-unknown}"
    printf 'staging_windows_bootstrap_canary_failure_boundary_message=%s\n' "${STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE:-unknown}"
    printf 'staging_firefox_extension_id=%s\n' "${STAGING_FIREFOX_EXTENSION_ID:-unknown}"
    printf 'staging_firefox_release_version=%s\n' "${STAGING_FIREFOX_RELEASE_VERSION:-unknown}"
    printf 'staging_firefox_signature_source=%s\n' "${STAGING_FIREFOX_SIGNATURE_SOURCE:-unknown}"
    printf 'staging_firefox_signature_state=%s\n' "${STAGING_FIREFOX_SIGNATURE_STATE:-unknown}"
    printf 'staging_firefox_metadata_sha256=%s\n' "${STAGING_FIREFOX_METADATA_SHA256:-unknown}"
    printf 'staging_firefox_xpi_sha256=%s\n' "${STAGING_FIREFOX_XPI_SHA256:-unknown}"
    printf 'staging_verified_at=%s\n' "${STAGING_VERIFIED_AT:-unknown}"
  } >> "$github_output_path"
}
