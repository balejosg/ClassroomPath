#!/usr/bin/env bash
# remote-helper-contracts.sh - Compatibility guards for streamed remote deploy helpers
# shellcheck shell=bash

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

release_manifest_helper_supports_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'release_manifest_validate_contract()' \
    'linux_agent_version'
}

release_manifest_compat_helper_supports_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'release_manifest_validate_contract()' \
    'export_release_manifest_runtime_env()'
}

release_state_helper_supports_runtime_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'write_deploy_context_state()' \
    'OPENPATH_LINUX_AGENT_VERSION'
}

release_state_helper_supports_staging_verification_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'write_staging_verification_state()' \
    'STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION'
}

release_state_compat_helper_supports_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'write_release_state_snapshot_compat()' \
    'release_state_list_fields_compat()'
}

deployment_state_helper_supports_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'deployment_state_capture_previous_release()' \
    'deployment_state_activate_previous_release()'
}

release_runtime_helper_supports_runtime_contract() {
  local helper_path="${1:-}"

  remote_helper_path_supports_all \
    "$helper_path" \
    'write_release_runtime_state()' \
    'OPENPATH_LINUX_AGENT_VERSION'
}

refresh_deployed_release_helpers() {
  RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")"
  RELEASE_MANIFEST_COMPAT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest-compat.sh")"
  RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
  RELEASE_STATE_COMPAT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state-compat.sh")"
  RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"

  if [ -n "${DEPLOYMENT_STATE_HELPER_PATH:-}" ]; then
    DEPLOYMENT_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-state.sh")"
  fi

  if release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_MANIFEST_HELPER_PATH"
  elif release_manifest_compat_helper_supports_contract "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"
  fi

  if [ "${REMOTE_RELEASE_STATE_CONTRACT_MODE:-runtime}" = "staging-verification" ]; then
    if release_state_helper_supports_staging_verification_contract "$RELEASE_STATE_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_STATE_HELPER_PATH"
    elif release_state_compat_helper_supports_contract "$RELEASE_STATE_COMPAT_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_STATE_COMPAT_HELPER_PATH"
    fi
  elif release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_STATE_HELPER_PATH"
  elif release_state_compat_helper_supports_contract "$RELEASE_STATE_COMPAT_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_STATE_COMPAT_HELPER_PATH"
  fi

  if [ -n "${DEPLOYMENT_STATE_HELPER_PATH:-}" ] && deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$DEPLOYMENT_STATE_HELPER_PATH"
  fi

  if [ -n "${RELEASE_RUNTIME_HELPER_PATH:-}" ] && release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
    # shellcheck disable=SC1090
    source "$RELEASE_RUNTIME_HELPER_PATH"
  fi
}
