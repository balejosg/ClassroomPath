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

apply_release_runtime_projection_to_env_file() {
  local runtime_file="$1"
  local env_file="$2"
  local field=""
  local value=""

  [ -f "$runtime_file" ] && [ ! -L "$runtime_file" ] || {
    log_error "Release runtime projection must be a regular non-symlink file"
    return 1
  }
  release_state_require_snapshot_fields "$runtime_file" current-runtime || return 1

  while IFS= read -r field; do
    [ -n "$field" ] || continue
    value="$(release_state_snapshot_value "$runtime_file" "$field")" || return 1
    case "$value" in
      ''|*[!A-Za-z0-9_@%+=:,./-]*)
        log_error "Release runtime projection contains an unsafe value for $field"
        return 1
        ;;
    esac
    upsert_env_file_var "$env_file" "$field" "$value" || return 1
  done < <(release_state_list_fields current-runtime)
}

require_windows_offline_installer_runtime_pin() {
  local name=""

  for name in \
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION \
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT \
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG \
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256; do
    if [ -z "${!name:-}" ]; then
      log_error "Windows offline installer runtime pin is missing: $name"
      return 1
    fi
    export "${name?}"
  done
}

require_openpath_linux_agent_runtime_pin() {
  local name=""
  local apt_suite="${OPENPATH_LINUX_AGENT_APT_SUITE:-}"

  for name in OPENPATH_LINUX_AGENT_VERSION OPENPATH_LINUX_AGENT_APT_SUITE; do
    if [ -z "${!name:-}" ]; then
      log_error "OpenPath Linux agent runtime pin is missing: $name"
      return 1
    fi
    export "${name?}"
  done

  case "$apt_suite" in
    stable|unstable)
      ;;
    *)
      log_error "OpenPath Linux agent APT suite is invalid: $apt_suite"
      return 1
      ;;
  esac
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
  local openpath_linux_agent_apt_suite="${10}"
  local spa_image="${11}"
  local template_version="${12:-${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}}"
  local template_commit="${13:-${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}}"
  local template_release_tag="${14:-${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}}"
  local template_sha256="${15:-${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}}"
  local release_id="${16:-${RELEASE_ID:-}}"
  local openpath_sha="${17:-${OPENPATH_SHA:-}}"
  local contract_sha256="${18:-${OPENPATH_CONTRACT_SHA256:-}}"
  local verifier_image="${19:-${CLASSROOMPATH_VERIFIER_IMAGE:-}}"
  local rc_run_id="${20:-${RC_RUN_ID:-}}"

  RELEASE_ID="$release_id" \
  APP_SHA="$app_sha" \
  OPENPATH_SHA="$openpath_sha" \
  OPENPATH_CONTRACT_SHA256="$contract_sha256" \
  IMAGE_SOURCE="$image_source" \
  CLASSROOMPATH_GATEWAY_IMAGE="$gateway_image" \
  CLASSROOMPATH_MIGRATIONS_IMAGE="$migrations_image" \
  OPENPATH_FIREFOX_ASSETS_IMAGE="$openpath_firefox_assets_image" \
  OPENPATH_API_IMAGE="$openpath_api_image" \
  OPENPATH_VERSION="$openpath_version" \
  OPENPATH_LINUX_AGENT_VERSION="$openpath_linux_agent_version" \
  OPENPATH_LINUX_AGENT_APT_SUITE="$openpath_linux_agent_apt_suite" \
  CLASSROOMPATH_SPA_IMAGE="$spa_image" \
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION="$template_version" \
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT="$template_commit" \
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG="$template_release_tag" \
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256="$template_sha256" \
  CLASSROOMPATH_VERIFIER_IMAGE="$verifier_image" \
  RC_RUN_ID="$rc_run_id" \
    write_current_release_state "$state_path"
}

prepare_openpath_firefox_assets_from_image() {
  local image_ref="${1:-${OPENPATH_FIREFOX_ASSETS_IMAGE:-}}"
  local app_sha="${2:-${TARGET_SHA:-${STAGING_RELEASE_SHA:-current}}}"
  local mode="${3:-activate}"
  local host_root="${OPENPATH_FIREFOX_RELEASE_HOST_ROOT:-${CLASSROOMPATH_DEPLOY_ROOT:-/srv/classroompath}/openpath-firefox-release}"
  local tmp_dir=""
  local target_dir=""
  local assets_container=""
  local generation_id=""

  case "$mode" in activate|prepare-only) ;; *) return 1 ;; esac

  if [ -z "$image_ref" ]; then
    log_error "OPENPATH_FIREFOX_ASSETS_IMAGE is missing from release-candidate runtime"
    return 1
  fi

  mkdir -p "$host_root" || return 1
  tmp_dir="$(mktemp -d "$host_root/.tmp.XXXXXX")" || return 1
  generation_id="${RELEASE_ID:-$app_sha}"
  if [[ ! "$generation_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
    log_error "OpenPath Firefox release generation id is invalid: $generation_id"
    rm -rf "$tmp_dir"
    return 1
  fi
  mkdir -p "$host_root/generations" || return 1
  target_dir="$host_root/generations/generation-$generation_id"

  docker pull "$image_ref" || {
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

  chmod 755 "$tmp_dir" || return 1
  chmod 644 "$tmp_dir/metadata.json" || return 1
  chmod 644 "$tmp_dir/openpath-firefox-extension.xpi" || return 1

  docker rm "$assets_container" >/dev/null 2>&1 || true
  if [ -e "$target_dir" ]; then
    if ! cmp -s "$tmp_dir/metadata.json" "$target_dir/metadata.json" ||
      ! cmp -s "$tmp_dir/openpath-firefox-extension.xpi" "$target_dir/openpath-firefox-extension.xpi"; then
      log_error "OpenPath Firefox release generation already exists with different bytes: $target_dir"
      rm -rf "$tmp_dir"
      return 1
    fi
    rm -rf "$tmp_dir"
  else
    mv "$tmp_dir" "$target_dir" || return 1
  fi
  export OPENPATH_FIREFOX_RELEASE_DIR="$target_dir"
  export OPENPATH_FIREFOX_RELEASE_ROOT=/openpath-firefox-release
  export OPENPATH_FIREFOX_RELEASE_GENERATION="$target_dir"
  if [ "$mode" = activate ]; then
    activate_openpath_firefox_assets_generation || return 1
  fi
}

activate_openpath_firefox_assets_generation() {
  local generation="${OPENPATH_FIREFOX_RELEASE_GENERATION:-}"
  local host_root="${OPENPATH_FIREFOX_RELEASE_HOST_ROOT:-${CLASSROOMPATH_DEPLOY_ROOT:-/srv/classroompath}/openpath-firefox-release}"
  [ -d "$generation" ] && [ ! -L "$generation" ] || return 1
  ln -sfn "$generation" "$host_root/current" || return 1
  export OPENPATH_FIREFOX_RELEASE_DIR="$host_root/current"
}
