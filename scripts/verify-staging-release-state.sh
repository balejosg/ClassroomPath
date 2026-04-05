#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/release-state.sh
source "$SCRIPT_DIR/lib/release-state.sh"

load_release_state_env ./staging-release-state.env
load_release_state_env ./staging-verification.env

if [ "${IMAGE_SOURCE:-}" != "release-candidate" ]; then
  echo "::error::Staging is not running release candidate images (IMAGE_SOURCE=${IMAGE_SOURCE:-unset})"
  exit 1
fi

if [ "${APP_SHA:-}" != "$EXPECTED_APP_SHA" ]; then
  echo "::error::Staging APP_SHA (${APP_SHA:-unset}) does not match tag SHA ($EXPECTED_APP_SHA)"
  exit 1
fi

compare_image() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if [ "$expected" != "$actual" ]; then
    echo "::error::$label mismatch. expected=$expected actual=$actual"
    exit 1
  fi
}

compare_image "Gateway image" "$EXPECTED_GATEWAY_IMAGE" "${CLASSROOMPATH_GATEWAY_IMAGE:-}"
compare_image "Migrations image" "$EXPECTED_MIGRATIONS_IMAGE" "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}"
compare_image "OpenPath API image" "$EXPECTED_OPENPATH_API_IMAGE" "${OPENPATH_API_IMAGE:-}"
compare_image "SPA image" "$EXPECTED_SPA_IMAGE" "${CLASSROOMPATH_SPA_IMAGE:-}"
compare_image "OpenPath Linux agent version" "$EXPECTED_OPENPATH_LINUX_AGENT_VERSION" "${OPENPATH_LINUX_AGENT_VERSION:-}"

if [ "${STAGING_SMOKE_RESULT:-}" != "success" ]; then
  echo "::error::Staging smoke evidence is missing or failed (STAGING_SMOKE_RESULT=${STAGING_SMOKE_RESULT:-unset})"
  exit 1
fi

if [ "${STAGING_RELEASE_GATE_RESULT:-}" != "success" ]; then
  echo "::error::Staging release-gate evidence is missing or failed (STAGING_RELEASE_GATE_RESULT=${STAGING_RELEASE_GATE_RESULT:-unset})"
  exit 1
fi

if [ "${STAGING_VERIFIED_IMAGE_SOURCE:-}" != "release-candidate" ]; then
  echo "::error::Staging verification evidence does not point to release candidate images (STAGING_VERIFIED_IMAGE_SOURCE=${STAGING_VERIFIED_IMAGE_SOURCE:-unset})"
  exit 1
fi

if [ "${STAGING_VERIFIED_APP_SHA:-}" != "$EXPECTED_APP_SHA" ]; then
  echo "::error::Staging verification SHA (${STAGING_VERIFIED_APP_SHA:-unset}) does not match tag SHA ($EXPECTED_APP_SHA)"
  exit 1
fi

compare_image "Verified gateway image" "$EXPECTED_GATEWAY_IMAGE" "${STAGING_VERIFIED_GATEWAY_IMAGE:-}"
compare_image "Verified migrations image" "$EXPECTED_MIGRATIONS_IMAGE" "${STAGING_VERIFIED_MIGRATIONS_IMAGE:-}"
compare_image "Verified OpenPath API image" "$EXPECTED_OPENPATH_API_IMAGE" "${STAGING_VERIFIED_OPENPATH_API_IMAGE:-}"
compare_image "Verified SPA image" "$EXPECTED_SPA_IMAGE" "${STAGING_VERIFIED_SPA_IMAGE:-}"
compare_image "Verified OpenPath Linux agent version" "$EXPECTED_OPENPATH_LINUX_AGENT_VERSION" "${STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION:-}"

if [ "$HIGH_RISK" = "true" ]; then
  if [ "${STAGING_SMOKE_STATUS:-}" = "PASS_WITH_FALLBACK" ]; then
    echo "::error::PASS_WITH_FALLBACK is not sufficient production evidence for Windows/Firefox delivery changes"
    exit 1
  fi

  if [ "${STAGING_WINDOWS_BOOTSTRAP_RESULT:-}" != "success" ]; then
    echo "::error::Windows bootstrap evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_RESULT=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-unset})"
    exit 1
  fi

  if [ "${STAGING_FIREFOX_POLICY_RESULT:-}" != "success" ]; then
    echo "::error::Firefox policy evidence is missing or failed (STAGING_FIREFOX_POLICY_RESULT=${STAGING_FIREFOX_POLICY_RESULT:-unset})"
    exit 1
  fi

  if [ "${STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS:-}" != "present" ]; then
    echo "::error::Firefox release artifacts were not marked present in staging verification evidence"
    exit 1
  fi

  for required_field in \
    STAGING_FIREFOX_EXTENSION_ID \
    STAGING_FIREFOX_RELEASE_VERSION \
    STAGING_FIREFOX_METADATA_SHA256 \
    STAGING_FIREFOX_XPI_SHA256; do
    if [ -z "${!required_field:-}" ]; then
      echo "::error::$required_field is missing from staging verification evidence"
      exit 1
    fi
  done
fi

echo "staging_smoke_result=${STAGING_SMOKE_RESULT:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_smoke_status=${STAGING_SMOKE_STATUS:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_release_gate_result=${STAGING_RELEASE_GATE_RESULT:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_windows_bootstrap_result=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_firefox_policy_result=${STAGING_FIREFOX_POLICY_RESULT:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_firefox_extension_id=${STAGING_FIREFOX_EXTENSION_ID:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_firefox_release_version=${STAGING_FIREFOX_RELEASE_VERSION:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_firefox_metadata_sha256=${STAGING_FIREFOX_METADATA_SHA256:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_firefox_xpi_sha256=${STAGING_FIREFOX_XPI_SHA256:-unknown}" >> "$GITHUB_OUTPUT"
echo "staging_verified_at=${STAGING_VERIFIED_AT:-unknown}" >> "$GITHUB_OUTPUT"
