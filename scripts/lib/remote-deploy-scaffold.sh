#!/usr/bin/env bash
# remote-deploy-scaffold.sh - Shared helper-path setup for streamed remote deploy entrypoints
# shellcheck shell=bash

remote_deploy_init_base_helper_paths() {
  local script_dir="$1"
  local app_dir="$2"

  COMMON_SH_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/common.sh")"
  RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-manifest.sh")"
  DEPLOY_PAYLOAD_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-payload.sh")"
  RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-state.sh")"
  RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-runtime.sh")"
  REMOTE_HELPER_CONTRACTS_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/remote-helper-contracts.sh")"
}

remote_deploy_init_production_helper_paths() {
  local script_dir="$1"
  local app_dir="$2"

  DEPLOYMENT_STATE_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deployment-state.sh")"
  DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-production-context.sh")"
  DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/deploy-production-runtime.sh")"
}

remote_deploy_reload_checked_out_helpers() {
  local common_sh_deployed_path="${1:-}"

  reload_deployed_common_helpers "$common_sh_deployed_path"
  refresh_deployed_release_helpers
}
