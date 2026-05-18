#!/usr/bin/env bash
# release-runtime.sh - Shared release manifest/state contract helpers
# shellcheck shell=bash

RELEASE_RUNTIME_HELPER_CONTRACT_VERSION=1

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
  local openpath_firefox_assets_image="${6:-}"
  local openpath_api_image="$7"
  local openpath_version="$8"
  local openpath_linux_agent_version="$9"
  local spa_image="${10}"

  APP_SHA="$app_sha" \
  IMAGE_SOURCE="$image_source" \
  CLASSROOMPATH_GATEWAY_IMAGE="$gateway_image" \
  CLASSROOMPATH_MIGRATIONS_IMAGE="$migrations_image" \
  OPENPATH_FIREFOX_ASSETS_IMAGE="$openpath_firefox_assets_image" \
  OPENPATH_API_IMAGE="$openpath_api_image" \
  OPENPATH_VERSION="$openpath_version" \
  OPENPATH_LINUX_AGENT_VERSION="$openpath_linux_agent_version" \
  CLASSROOMPATH_SPA_IMAGE="$spa_image" \
    write_current_release_state "$state_path"
}

prepare_openpath_firefox_assets_from_image() {
  local image_ref="${1:-${OPENPATH_FIREFOX_ASSETS_IMAGE:-}}"
  local app_sha="${2:-${TARGET_SHA:-${STAGING_RELEASE_SHA:-current}}}"
  local host_root="${OPENPATH_FIREFOX_RELEASE_HOST_ROOT:-${CLASSROOMPATH_DEPLOY_ROOT:-/srv/classroompath}/openpath-firefox-release}"
  local tmp_dir=""
  local target_dir=""
  local assets_container=""

  if [ -z "$image_ref" ]; then
    log_error "OPENPATH_FIREFOX_ASSETS_IMAGE is missing from release-candidate runtime"
    return 1
  fi

  mkdir -p "$host_root"
  tmp_dir="$(mktemp -d "$host_root/.tmp.XXXXXX")"
  target_dir="$host_root/$app_sha"

  docker pull "$OPENPATH_FIREFOX_ASSETS_IMAGE" || {
    rm -rf "$tmp_dir"
    return 1
  }

  assets_container="$(docker create "$image_ref")" || {
    rm -rf "$tmp_dir"
    return 1
  }

  if ! docker cp "$assets_container:/openpath-firefox-release/metadata.json" "$tmp_dir/metadata.json" ||
    ! docker cp "$assets_container:/openpath-firefox-release/openpath-firefox-extension.xpi" "$tmp_dir/openpath-firefox-extension.xpi"; then
    docker rm "$assets_container" >/dev/null 2>&1 || true
    rm -rf "$tmp_dir"
    return 1
  fi

  chmod 755 "$tmp_dir"
  chmod 644 "$tmp_dir/metadata.json"
  chmod 644 "$tmp_dir/openpath-firefox-extension.xpi"

  docker rm "$assets_container" >/dev/null 2>&1 || true
  rm -rf "$target_dir"
  mv "$tmp_dir" "$target_dir"
  ln -sfn "$target_dir" "$host_root/current"

  export OPENPATH_FIREFOX_RELEASE_DIR="$host_root/current"
  export OPENPATH_FIREFOX_RELEASE_ROOT=/openpath-firefox-release
}
