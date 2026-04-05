#!/usr/bin/env bash
# release-manifest.sh - Helpers for release image manifest payloads
# shellcheck shell=bash

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

  export OPENPATH_API_IMAGE
  OPENPATH_API_IMAGE="$(release_manifest_require_key "$manifest_path" openpath_api_image)"

  export OPENPATH_LINUX_AGENT_VERSION
  OPENPATH_LINUX_AGENT_VERSION="$(release_manifest_require_key "$manifest_path" linux_agent_version)"

  export CLASSROOMPATH_SPA_IMAGE
  CLASSROOMPATH_SPA_IMAGE="$(release_manifest_require_key "$manifest_path" spa_image)"

  export CLASSROOMPATH_VERIFIER_IMAGE
  CLASSROOMPATH_VERIFIER_IMAGE="$(release_manifest_require_key "$manifest_path" verifier_image)"
}
