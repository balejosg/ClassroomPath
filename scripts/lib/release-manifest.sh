#!/usr/bin/env bash
# release-manifest.sh - Helpers for release image manifest payloads
# shellcheck shell=bash

RELEASE_MANIFEST_HELPER_CONTRACT_VERSION=1

release_manifest_get() {
  local manifest_path="$1"
  local key="$2"

  awk -v key="$key" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$manifest_path"
}

release_manifest_require_key() {
  local manifest_path="$1"
  local key="$2"
  local value=""

  value="$(release_manifest_get "$manifest_path" "$key")" || {
    log_error "Release manifest missing key: $key"
    return 1
  }

  printf '%s\n' "$value"
}

release_manifest_is_canonical_contract() {
  local manifest_path="$1"
  local key=""

  for key in \
    repository \
    run_id \
    app_sha \
    gateway_image \
    migrations_image \
    openpath_firefox_assets_image \
    openpath_api_image \
    openpath_version \
    linux_agent_version \
    linux_agent_apt_suite \
    spa_image \
    verifier_image; do
    if ! release_manifest_get "$manifest_path" "$key" >/dev/null 2>&1; then
      return 1
    fi
  done

  return 0
}

release_manifest_validate_contract() {
  local manifest_path="$1"
  local expected_sha="${2:-}"
  local repository=""
  local run_id=""
  local app_sha=""
  local openpath_version=""
  local linux_agent_version=""
  local linux_agent_apt_suite=""
  local image_key=""
  local image_ref=""

  repository="$(release_manifest_require_key "$manifest_path" repository)" || return 1
  run_id="$(release_manifest_require_key "$manifest_path" run_id)" || return 1
  app_sha="$(release_manifest_require_key "$manifest_path" app_sha)" || return 1
  openpath_version="$(release_manifest_require_key "$manifest_path" openpath_version)" || return 1
  linux_agent_version="$(release_manifest_require_key "$manifest_path" linux_agent_version)" || return 1
  linux_agent_apt_suite="$(release_manifest_require_key "$manifest_path" linux_agent_apt_suite)" || return 1

  if [[ ! "$repository" =~ ^[^/]+/[^/]+$ ]]; then
    log_error "Release manifest repository is invalid: $repository"
    return 1
  fi

  if [[ ! "$run_id" =~ ^[0-9]+$ ]]; then
    log_error "Release manifest run_id is invalid: $run_id"
    return 1
  fi

  if [[ ! "$app_sha" =~ ^[0-9a-f]{40}$ ]]; then
    log_error "Release manifest app_sha is invalid: $app_sha"
    return 1
  fi

  if [ -n "$expected_sha" ] && [ "$app_sha" != "$expected_sha" ]; then
    log_error "Release manifest app_sha does not match expected SHA: expected=$expected_sha actual=$app_sha"
    return 1
  fi

  if [[ ! "$openpath_version" =~ ^[0-9]+(\.[0-9]+)*(-[0-9A-Za-z._-]+)?$ ]]; then
    log_error "Release manifest openpath_version is invalid: $openpath_version"
    return 1
  fi

  if [[ ! "$linux_agent_version" =~ ^[0-9]+(\.[0-9]+)*(-[0-9A-Za-z._-]+)?$ ]]; then
    log_error "Release manifest linux_agent_version is invalid: $linux_agent_version"
    return 1
  fi

  if [ "$linux_agent_apt_suite" != "stable" ] && [ "$linux_agent_apt_suite" != "unstable" ]; then
    log_error "Release manifest linux_agent_apt_suite is invalid: $linux_agent_apt_suite"
    return 1
  fi

  for image_key in gateway_image migrations_image openpath_firefox_assets_image openpath_api_image spa_image verifier_image; do
    image_ref="$(release_manifest_require_key "$manifest_path" "$image_key")" || return 1
    if [[ ! "$image_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
      log_error "Release manifest image ref is not pinned by digest: $image_key=$image_ref"
      return 1
    fi
  done
}

encode_release_manifest_base64() {
  local manifest_path="$1"

  base64 < "$manifest_path" | tr -d '\n'
}

decode_release_manifest_base64() {
  local manifest_b64="$1"
  local target_path="${2:-$(mktemp)}"

  if [ -z "$manifest_b64" ]; then
    log_error "Release manifest payload is empty"
    return 1
  fi

  printf '%s' "$manifest_b64" | base64 --decode > "$target_path"
  printf '%s\n' "$target_path"
}

export_release_manifest_runtime_env() {
  local manifest_path="$1"

  export RELEASE_MANIFEST_REPOSITORY
  RELEASE_MANIFEST_REPOSITORY="$(release_manifest_require_key "$manifest_path" repository)"

  export RELEASE_MANIFEST_RUN_ID
  RELEASE_MANIFEST_RUN_ID="$(release_manifest_require_key "$manifest_path" run_id)"

  export RELEASE_MANIFEST_APP_SHA
  RELEASE_MANIFEST_APP_SHA="$(release_manifest_require_key "$manifest_path" app_sha)"

  export CLASSROOMPATH_GATEWAY_IMAGE
  CLASSROOMPATH_GATEWAY_IMAGE="$(release_manifest_require_key "$manifest_path" gateway_image)"

  export CLASSROOMPATH_MIGRATIONS_IMAGE
  CLASSROOMPATH_MIGRATIONS_IMAGE="$(release_manifest_require_key "$manifest_path" migrations_image)"

  export OPENPATH_FIREFOX_ASSETS_IMAGE
  OPENPATH_FIREFOX_ASSETS_IMAGE="$(release_manifest_require_key "$manifest_path" openpath_firefox_assets_image)"

  export OPENPATH_API_IMAGE
  OPENPATH_API_IMAGE="$(release_manifest_require_key "$manifest_path" openpath_api_image)"

  export OPENPATH_VERSION
  OPENPATH_VERSION="$(release_manifest_require_key "$manifest_path" openpath_version)"

  export OPENPATH_LINUX_AGENT_VERSION
  OPENPATH_LINUX_AGENT_VERSION="$(release_manifest_require_key "$manifest_path" linux_agent_version)"

  export OPENPATH_LINUX_AGENT_APT_SUITE
  OPENPATH_LINUX_AGENT_APT_SUITE="$(release_manifest_require_key "$manifest_path" linux_agent_apt_suite)"

  export CLASSROOMPATH_SPA_IMAGE
  CLASSROOMPATH_SPA_IMAGE="$(release_manifest_require_key "$manifest_path" spa_image)"

  export CLASSROOMPATH_VERIFIER_IMAGE
  CLASSROOMPATH_VERIFIER_IMAGE="$(release_manifest_require_key "$manifest_path" verifier_image)"
}
