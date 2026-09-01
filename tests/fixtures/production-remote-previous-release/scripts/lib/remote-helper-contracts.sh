#!/usr/bin/env bash
# remote-helper-contracts.sh - Versioned predecessor contract fixture
# shellcheck shell=bash

RELEASE_MANIFEST_HELPER_MIN_CONTRACT_VERSION=1
RELEASE_STATE_RUNTIME_MIN_CONTRACT_VERSION=1
DEPLOYMENT_STATE_HELPER_MIN_CONTRACT_VERSION=1
RELEASE_RUNTIME_HELPER_MIN_CONTRACT_VERSION=1

remote_helper_contract_version() {
  local helper_path="${1:-}"
  local variable_name="${2:-}"

  [ -f "$helper_path" ] || return 1
  awk -F= -v variable_name="$variable_name" '$1 == variable_name { print $2; found=1; exit } END { exit(found ? 0 : 1) }' "$helper_path"
}

remote_helper_contract_version_at_least() {
  local helper_path="${1:-}"
  local variable_name="${2:-}"
  local minimum_version="${3:-}"
  local version=""

  version="$(remote_helper_contract_version "$helper_path" "$variable_name")" || return 1
  [[ "$version" =~ ^[0-9]+$ ]] && [ "$version" -ge "$minimum_version" ]
}

release_manifest_helper_supports_contract() {
  remote_helper_contract_version_at_least "$1" RELEASE_MANIFEST_HELPER_CONTRACT_VERSION "$RELEASE_MANIFEST_HELPER_MIN_CONTRACT_VERSION"
}

release_state_helper_supports_runtime_contract() {
  remote_helper_contract_version_at_least "$1" RELEASE_STATE_HELPER_CONTRACT_VERSION "$RELEASE_STATE_RUNTIME_MIN_CONTRACT_VERSION"
}

deployment_state_helper_supports_contract() {
  remote_helper_contract_version_at_least "$1" DEPLOYMENT_STATE_HELPER_CONTRACT_VERSION "$DEPLOYMENT_STATE_HELPER_MIN_CONTRACT_VERSION"
}

release_runtime_helper_supports_runtime_contract() {
  remote_helper_contract_version_at_least "$1" RELEASE_RUNTIME_HELPER_CONTRACT_VERSION "$RELEASE_RUNTIME_HELPER_MIN_CONTRACT_VERSION"
}

refresh_deployed_release_helpers() {
  RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")"
  RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
  RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"
  RELEASE_EXECUTION_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-execution.sh")"

  if [ -n "${DEPLOYMENT_STATE_HELPER_PATH:-}" ]; then
    DEPLOYMENT_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-state.sh")"
  fi

  release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH" || return 1
  release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH" || return 1
  [ -f "$RELEASE_RUNTIME_HELPER_PATH" ] && source "$RELEASE_RUNTIME_HELPER_PATH"
  [ -f "$DEPLOYMENT_STATE_HELPER_PATH" ] && source "$DEPLOYMENT_STATE_HELPER_PATH"
  [ -f "$RELEASE_EXECUTION_HELPER_PATH" ] && source "$RELEASE_EXECUTION_HELPER_PATH"
}
