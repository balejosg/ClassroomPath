#!/usr/bin/env bash
# remote-helper-contracts.sh - Compatibility guards for streamed remote deploy helpers
# shellcheck shell=bash

RELEASE_MANIFEST_HELPER_MIN_CONTRACT_VERSION=1
RELEASE_STATE_RUNTIME_MIN_CONTRACT_VERSION=1
RELEASE_STATE_STAGING_VERIFICATION_MIN_CONTRACT_VERSION=1
DEPLOYMENT_STATE_HELPER_MIN_CONTRACT_VERSION=1
RELEASE_RUNTIME_HELPER_MIN_CONTRACT_VERSION=1
RELEASE_EXECUTION_HELPER_MIN_CONTRACT_VERSION=2
RELEASE_RISK_POLICY_HELPER_MIN_CONTRACT_VERSION=1

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

remote_helper_contract_version() {
  local helper_path="${1:-}"
  local variable_name="${2:-}"
  local version=""

  [ -f "$helper_path" ] || return 1

  version="$(
    awk -F= -v variable_name="$variable_name" '
      $1 == variable_name {
        value = $2
        sub(/[[:space:]]+#.*$/, "", value)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print value
        found = 1
        exit
      }
      END {
        if (!found) {
          exit 1
        }
      }
    ' "$helper_path"
  )" || return 1

  [[ "$version" =~ ^[0-9]+$ ]] || return 2
  printf '%s\n' "$version"
}

remote_helper_contract_version_at_least() {
  local helper_path="${1:-}"
  local variable_name="${2:-}"
  local minimum_version="${3:-}"
  local version=""
  local status=0

  version="$(remote_helper_contract_version "$helper_path" "$variable_name")"
  status=$?

  case "$status" in
    0)
      [ "$version" -ge "$minimum_version" ]
      return $?
      ;;
    1)
      return 2
      ;;
    *)
      return 1
      ;;
  esac
}

release_manifest_helper_supports_contract() {
  local helper_path="${1:-}"
  remote_helper_contract_version_at_least \
    "$helper_path" \
    RELEASE_MANIFEST_HELPER_CONTRACT_VERSION \
    "$RELEASE_MANIFEST_HELPER_MIN_CONTRACT_VERSION"
}

release_state_helper_supports_runtime_contract() {
  local helper_path="${1:-}"
  remote_helper_contract_version_at_least \
    "$helper_path" \
    RELEASE_STATE_HELPER_CONTRACT_VERSION \
    "$RELEASE_STATE_RUNTIME_MIN_CONTRACT_VERSION"
}

release_state_helper_supports_staging_verification_contract() {
  local helper_path="${1:-}"
  remote_helper_contract_version_at_least \
    "$helper_path" \
    RELEASE_STATE_HELPER_CONTRACT_VERSION \
    "$RELEASE_STATE_STAGING_VERIFICATION_MIN_CONTRACT_VERSION"
}

deployment_state_helper_supports_contract() {
  local helper_path="${1:-}"
  remote_helper_contract_version_at_least \
    "$helper_path" \
    DEPLOYMENT_STATE_HELPER_CONTRACT_VERSION \
    "$DEPLOYMENT_STATE_HELPER_MIN_CONTRACT_VERSION"
}

release_runtime_helper_supports_runtime_contract() {
  local helper_path="${1:-}"
  remote_helper_contract_version_at_least \
    "$helper_path" \
    RELEASE_RUNTIME_HELPER_CONTRACT_VERSION \
    "$RELEASE_RUNTIME_HELPER_MIN_CONTRACT_VERSION"
}

release_risk_policy_helper_supports_contract() {
  local helper_path="${1:-}"
  remote_helper_contract_version_at_least \
    "$helper_path" \
    RELEASE_RISK_POLICY_HELPER_CONTRACT_VERSION \
    "$RELEASE_RISK_POLICY_HELPER_MIN_CONTRACT_VERSION"
}

release_execution_helper_supports_contract() {
  local helper_path="${1:-}"
  local helper_dir=""
  local status=0

  remote_helper_contract_version_at_least \
    "$helper_path" \
    RELEASE_EXECUTION_HELPER_CONTRACT_VERSION \
    "$RELEASE_EXECUTION_HELPER_MIN_CONTRACT_VERSION"
  status=$?

  if [ "$status" -ne 0 ]; then
    return "$status"
  fi

  helper_dir="$(cd "$(dirname "$helper_path")" && pwd)" || return 2
  release_risk_policy_helper_supports_contract "$helper_dir/release-risk-policy.sh"
}

refresh_deployed_release_helpers() {
  RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")"
  RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
  RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"
  RELEASE_EXECUTION_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-execution.sh")"

  if [ -n "${DEPLOYMENT_STATE_HELPER_PATH:-}" ]; then
    DEPLOYMENT_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-state.sh")"
  fi

  if release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_MANIFEST_HELPER_PATH"
  else
    return 1
  fi

  if [ "${REMOTE_RELEASE_STATE_CONTRACT_MODE:-runtime}" = "staging-verification" ]; then
    if release_state_helper_supports_staging_verification_contract "$RELEASE_STATE_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_STATE_HELPER_PATH"
    else
      return 1
    fi
  elif release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_STATE_HELPER_PATH"
  else
    return 1
  fi

  if [ -n "${DEPLOYMENT_STATE_HELPER_PATH:-}" ] && deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$DEPLOYMENT_STATE_HELPER_PATH"
  fi

  if [ -n "${RELEASE_RUNTIME_HELPER_PATH:-}" ] && release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_RUNTIME_HELPER_PATH"
  fi

  if [ -n "${RELEASE_EXECUTION_HELPER_PATH:-}" ] && release_execution_helper_supports_contract "$RELEASE_EXECUTION_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_EXECUTION_HELPER_PATH"
  fi
}
