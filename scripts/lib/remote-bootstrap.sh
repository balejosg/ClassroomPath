#!/usr/bin/env bash
# remote-bootstrap.sh - Shared helpers for streamed remote deployment scripts
# shellcheck shell=bash

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

reload_deployed_common_helpers() {
  local common_sh_deployed_path="${1:-}"

  if [ -f "$common_sh_deployed_path" ]; then
    # shellcheck disable=SC1090
    source "$common_sh_deployed_path"
  fi
}
