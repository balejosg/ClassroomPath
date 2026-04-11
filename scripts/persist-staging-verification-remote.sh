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

if [ -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  # shellcheck source=lib/remote-bootstrap.sh
  source "$REMOTE_BOOTSTRAP_HELPER_PATH"
else
  resolve_remote_script_dir() {
    local app_dir="$1"
    local script_source="${2:-}"

    if [ -n "$script_source" ]; then
      cd "$(dirname "$script_source")" && pwd
      return 0
    fi

    printf '%s/scripts\n' "$app_dir"
  }

  resolve_remote_helper_path() {
    local script_dir="$1"
    local app_dir="$2"
    local relative_path="$3"
    local resolved_path="$script_dir/$relative_path"

    if [ ! -f "$resolved_path" ]; then
      resolved_path="$app_dir/scripts/$relative_path"
    fi

    printf '%s\n' "$resolved_path"
  }
fi

SCRIPT_DIR="$(resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE")"
COMMON_SH_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/common.sh")"
RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
STAGING_VERIFICATION_RUNNER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "run-staging-verification.sh")"
REMOTE_HELPER_CONTRACTS_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-helper-contracts.sh")"

if [ -f "$REMOTE_HELPER_CONTRACTS_PATH" ]; then
  REMOTE_RELEASE_STATE_CONTRACT_MODE="staging-verification"
  export REMOTE_RELEASE_STATE_CONTRACT_MODE
  # shellcheck source=lib/remote-helper-contracts.sh
  source "$REMOTE_HELPER_CONTRACTS_PATH"
else
  remote_helper_path_supports_all() {
    local helper_path="${1:-}"
    shift || true
    local required_snippet=""

    [ -f "$helper_path" ] || return 1

    for required_snippet in "$@"; do
      if ! grep -q "$required_snippet" "$helper_path"; then
        return 1
      fi
    done

    return 0
  }

  release_state_helper_supports_staging_verification_contract() {
    local helper_path="${1:-}"
    remote_helper_path_supports_all "$helper_path" 'write_staging_verification_state()' 'STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION'
  }
fi

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"

if ! release_state_helper_supports_staging_verification_contract "$RELEASE_STATE_HELPER_PATH"; then
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

  write_release_state_snapshot() {
    local snapshot_type="$1"
    local state_path="$2"
    local field=""
    local value=""

    mkdir -p "$(dirname "$state_path")"
    : > "$state_path"

    case "$snapshot_type" in
      staging-verification)
        while IFS= read -r field; do
          [ -z "$field" ] && continue
          value="${!field:-}"
          printf '%s=%q\n' "$field" "$value" >> "$state_path"
        done <<'EOF'
STAGING_VERIFIED_AT
STAGING_VERIFIED_BY
STAGING_VERIFIED_APP_SHA
STAGING_VERIFIED_OPENPATH_SHA
STAGING_VERIFIED_IMAGE_SOURCE
STAGING_VERIFIED_GATEWAY_IMAGE
STAGING_VERIFIED_MIGRATIONS_IMAGE
STAGING_VERIFIED_OPENPATH_API_IMAGE
STAGING_VERIFIED_OPENPATH_VERSION
STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION
STAGING_VERIFIED_SPA_IMAGE
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS
STAGING_SMOKE_RESULT
STAGING_SMOKE_STATUS
STAGING_RELEASE_GATE_RESULT
STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT
STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256
EOF
        ;;
      *)
        log_error "Unsupported snapshot fallback: $snapshot_type"
        return 1
        ;;
    esac
  }

  write_staging_verification_state() {
    local state_path="$1"
    write_release_state_snapshot "staging-verification" "$state_path"
  }
else
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

if [ ! -f "$STAGING_VERIFICATION_RUNNER_PATH" ]; then
  log_error "Shared staging verification runner not found: $STAGING_VERIFICATION_RUNNER_PATH"
  exit 1
fi

STATE_DIR="${STATE_DIR:-/opt/classroompath/release-state}"
STAGING_VERIFICATION_STATE_FILE="$STATE_DIR/staging-verification.env"
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS \
STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT \
STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT \
STAGING_FIREFOX_EXTENSION_ID=$STAGING_FIREFOX_EXTENSION_ID \
STAGING_FIREFOX_RELEASE_VERSION=$STAGING_FIREFOX_RELEASE_VERSION \
STAGING_FIREFOX_METADATA_SHA256=$STAGING_FIREFOX_METADATA_SHA256 \
STAGING_FIREFOX_XPI_SHA256=$STAGING_FIREFOX_XPI_SHA256 \
  bash "$STAGING_VERIFICATION_RUNNER_PATH" persist-evidence
