#!/usr/bin/env bash
# remote-deploy-scaffold.sh - Versioned predecessor contract fixture
# shellcheck shell=bash

remote_deploy_init_base_helper_paths() {
  local script_dir="$1"
  local app_dir="$2"

  COMMON_SH_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/common.sh")"
  DEPLOY_HOST_PREFLIGHT_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-host-preflight.sh")"
  RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-manifest.sh")"
  DEPLOY_PAYLOAD_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-payload.sh")"
  RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-state.sh")"
  RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-runtime.sh")"
  RELEASE_EXECUTION_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-execution.sh")"
  REMOTE_HELPER_CONTRACTS_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/remote-helper-contracts.sh")"
}

remote_deploy_init_production_helper_paths() {
  local script_dir="$1"
  local app_dir="$2"

  DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-production-context.sh")"
  DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-production-runtime.sh")"
}

remote_deploy_reload_checked_out_helpers() {
  local common_sh_deployed_path="${1:-}"

  reload_deployed_common_helpers "$common_sh_deployed_path"
  REMOTE_BOOTSTRAP_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-bootstrap.sh")"
  if [ -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
    # shellcheck disable=SC1090
    source "$REMOTE_BOOTSTRAP_HELPER_PATH"
  fi
  REMOTE_HELPER_CONTRACTS_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-helper-contracts.sh")"
  if [ -f "$REMOTE_HELPER_CONTRACTS_PATH" ]; then
    # shellcheck disable=SC1090
    source "$REMOTE_HELPER_CONTRACTS_PATH"
  fi
  DEPLOY_HOST_PREFLIGHT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-host-preflight.sh")"
  if [ -f "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH" ]; then
    # shellcheck disable=SC1090
    source "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH"
  fi
  refresh_deployed_release_helpers
}
