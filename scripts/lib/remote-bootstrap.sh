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

run_remote_deploy_phases() {
  local phase_name=""

  for phase_name in "$@"; do
    "$phase_name"
  done
}

run_remote_deploy_phase_group() {
  local group_name="$1"
  shift

  local phase_name=""
  local -a phase_names=()
  local -a phase_pids=()
  local -a failed_phases=()
  local index=0
  local status=0

  for phase_name in "$@"; do
    "$phase_name" &
    phase_names+=("$phase_name")
    phase_pids+=("$!")
  done

  for index in "${!phase_pids[@]}"; do
    if ! wait "${phase_pids[$index]}"; then
      status=1
      failed_phases+=("${phase_names[$index]}")
    fi
  done

  if [ "$status" -ne 0 ]; then
    printf 'Remote deploy phase group failed (%s): %s\n' "$group_name" "${failed_phases[*]}" >&2
    return "$status"
  fi
}
