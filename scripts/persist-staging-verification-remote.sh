#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/classroompath/app}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  SCRIPT_DIR="$APP_DIR/scripts"
fi

REMOTE_BOOTSTRAP_HELPER_PATH="$SCRIPT_DIR/lib/remote-bootstrap.sh"
if [ ! -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  REMOTE_BOOTSTRAP_HELPER_PATH="$APP_DIR/scripts/lib/remote-bootstrap.sh"
fi

if [ ! -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  printf 'Remote bootstrap helper not found: %s\n' "$REMOTE_BOOTSTRAP_HELPER_PATH" >&2
  exit 1
fi

# shellcheck source=lib/remote-bootstrap.sh
source "$REMOTE_BOOTSTRAP_HELPER_PATH"

SCRIPT_DIR="$(resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE")"
COMMON_SH_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/common.sh")"
RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
STAGING_VERIFICATION_RUNNER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "run-staging-verification.sh")"
REMOTE_HELPER_CONTRACTS_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-helper-contracts.sh")"

if [ ! -f "$REMOTE_HELPER_CONTRACTS_PATH" ]; then
  printf 'Remote helper contract helper not found: %s\n' "$REMOTE_HELPER_CONTRACTS_PATH" >&2
  exit 1
fi

# shellcheck source=lib/remote-helper-contracts.sh
source "$REMOTE_HELPER_CONTRACTS_PATH"

if [ ! -f "$COMMON_SH_PATH" ]; then
  printf 'Shared common helper not found: %s\n' "$COMMON_SH_PATH" >&2
  exit 1
fi

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"

if release_state_helper_supports_staging_verification_contract "$RELEASE_STATE_HELPER_PATH"; then
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
else
  log_error "Remote release-state helper does not meet the minimum staging verification contract"
  exit 1
fi

if [ ! -f "$STAGING_VERIFICATION_RUNNER_PATH" ]; then
  log_error "Shared staging verification runner not found: $STAGING_VERIFICATION_RUNNER_PATH"
  exit 1
fi

STATE_DIR="${STATE_DIR:-/opt/classroompath/release-state}"
STAGING_VERIFICATION_STATE_FILE="$STATE_DIR/staging-verification.env"
STAGING_EMAIL_PREFLIGHT_MODE=${STAGING_EMAIL_PREFLIGHT_MODE:-unknown} \
STAGING_EMAIL_DELIVERY_HIGH_RISK=${STAGING_EMAIL_DELIVERY_HIGH_RISK:-unknown} \
STAGING_EMAIL_PREFLIGHT_RESULT=${STAGING_EMAIL_PREFLIGHT_RESULT:-unknown} \
STAGING_EMAIL_PREFLIGHT_PROVIDER=${STAGING_EMAIL_PREFLIGHT_PROVIDER:-unknown} \
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS \
STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT \
STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT \
STAGING_FIREFOX_EXTENSION_ID=$STAGING_FIREFOX_EXTENSION_ID \
STAGING_FIREFOX_RELEASE_VERSION=$STAGING_FIREFOX_RELEASE_VERSION \
STAGING_FIREFOX_METADATA_SHA256=$STAGING_FIREFOX_METADATA_SHA256 \
STAGING_FIREFOX_XPI_SHA256=$STAGING_FIREFOX_XPI_SHA256 \
STAGING_LINUX_BOOTSTRAP_RESULT="${STAGING_LINUX_BOOTSTRAP_RESULT:-}" \
STAGING_LINUX_BOOTSTRAP_RUN_ID="${STAGING_LINUX_BOOTSTRAP_RUN_ID:-}" \
STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID="${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID:-}" \
STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE="${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:-}" \
  bash "$STAGING_VERIFICATION_RUNNER_PATH" persist-evidence
