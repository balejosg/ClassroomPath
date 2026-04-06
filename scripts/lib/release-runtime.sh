#!/usr/bin/env bash
# release-runtime.sh - Shared release manifest/state contract helpers
# shellcheck shell=bash

load_release_manifest_runtime() {
  local manifest_path="$1"
  local expected_sha="${2:-}"

  release_manifest_validate_contract "$manifest_path" "$expected_sha"
  export_release_manifest_runtime_env "$manifest_path"
}

write_release_runtime_state() {
  local state_path="$1"
  local app_sha="$2"
  local image_source="$3"
  local gateway_image="$4"
  local migrations_image="$5"
  local openpath_api_image="$6"
  local openpath_linux_agent_version="$7"
  local spa_image="$8"

  APP_SHA="$app_sha" \
  IMAGE_SOURCE="$image_source" \
  CLASSROOMPATH_GATEWAY_IMAGE="$gateway_image" \
  CLASSROOMPATH_MIGRATIONS_IMAGE="$migrations_image" \
  OPENPATH_API_IMAGE="$openpath_api_image" \
  OPENPATH_LINUX_AGENT_VERSION="$openpath_linux_agent_version" \
  CLASSROOMPATH_SPA_IMAGE="$spa_image" \
    write_current_release_state "$state_path"
}
