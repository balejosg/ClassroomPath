#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/opt/classroompath/app"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
RELEASE_MANIFEST_HELPER_PATH=""

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  SCRIPT_DIR="$APP_DIR/scripts"
fi

REMOTE_BOOTSTRAP_HELPER_PATH="$SCRIPT_DIR/lib/remote-bootstrap.sh"
if [ ! -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  REMOTE_BOOTSTRAP_HELPER_PATH="$APP_DIR/scripts/lib/remote-bootstrap.sh"
fi

if [ -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  # shellcheck source=lib/remote-bootstrap.sh
  source "$REMOTE_BOOTSTRAP_HELPER_PATH"
else
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
fi

if ! declare -F run_remote_deploy_phases >/dev/null; then
  run_remote_deploy_phases() {
    local phase_name=""

    for phase_name in "$@"; do
      "$phase_name"
    done
  }
fi

SCRIPT_DIR="$(resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE")"
REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-deploy-scaffold.sh")"

if [ -f "$REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH" ]; then
  # shellcheck source=lib/remote-deploy-scaffold.sh
  source "$REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH"
else
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

  remote_deploy_reload_checked_out_helpers() {
    local common_sh_deployed_path="${1:-}"

    reload_deployed_common_helpers "$common_sh_deployed_path"
    refresh_deployed_release_helpers
  }
fi

remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"

if [ -f "$REMOTE_HELPER_CONTRACTS_PATH" ]; then
  # shellcheck source=lib/remote-helper-contracts.sh
  source "$REMOTE_HELPER_CONTRACTS_PATH"
else
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
    remote_helper_path_supports_all "$helper_path" 'release_manifest_validate_contract()' 'linux_agent_version'
  }

  release_state_helper_supports_runtime_contract() {
    local helper_path="${1:-}"
    remote_helper_path_supports_all "$helper_path" 'write_deploy_context_state()' 'OPENPATH_LINUX_AGENT_VERSION'
  }

  release_runtime_helper_supports_runtime_contract() {
    local helper_path="${1:-}"
    remote_helper_path_supports_all "$helper_path" 'write_release_runtime_state()' 'OPENPATH_LINUX_AGENT_VERSION'
  }

  refresh_deployed_release_helpers() {
    RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")"
    RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
    RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"

    if release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_MANIFEST_HELPER_PATH"
    fi

    if release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_STATE_HELPER_PATH"
    fi

    if release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_RUNTIME_HELPER_PATH"
    fi
  }
fi

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"

if ! release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then
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

  release_manifest_validate_contract() {
    local manifest_path="$1"
    local expected_sha="${2:-}"
    local repository=""
    local run_id=""
    local app_sha=""
    local openpath_version=""
    local linux_agent_version=""
    local image_key=""
    local image_ref=""

    repository="$(release_manifest_require_key "$manifest_path" repository)" || return 1
    run_id="$(release_manifest_require_key "$manifest_path" run_id)" || return 1
    app_sha="$(release_manifest_require_key "$manifest_path" app_sha)" || return 1
    openpath_version="$(release_manifest_require_key "$manifest_path" openpath_version)" || return 1
    linux_agent_version="$(release_manifest_require_key "$manifest_path" linux_agent_version)" || return 1

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

    for image_key in gateway_image migrations_image openpath_api_image spa_image verifier_image; do
      image_ref="$(release_manifest_require_key "$manifest_path" "$image_key")" || return 1
      if [[ ! "$image_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
        log_error "Release manifest image ref is not pinned by digest: $image_key=$image_ref"
        return 1
      fi
    done
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

    export OPENPATH_VERSION
    OPENPATH_VERSION="$(release_manifest_require_key "$manifest_path" openpath_version)"

    export OPENPATH_LINUX_AGENT_VERSION
    OPENPATH_LINUX_AGENT_VERSION="$(release_manifest_require_key "$manifest_path" linux_agent_version)"

    export CLASSROOMPATH_SPA_IMAGE
    CLASSROOMPATH_SPA_IMAGE="$(release_manifest_require_key "$manifest_path" spa_image)"

    export CLASSROOMPATH_VERIFIER_IMAGE
    CLASSROOMPATH_VERIFIER_IMAGE="$(release_manifest_require_key "$manifest_path" verifier_image)"
  }
else
  # shellcheck source=lib/release-manifest.sh
  source "$RELEASE_MANIFEST_HELPER_PATH"
fi

if [ ! -f "$DEPLOY_PAYLOAD_HELPER_PATH" ]; then
  decode_deploy_payload_base64() {
    local payload_b64="$1"
    local target_path="${2:-$(mktemp)}"

    if [ -z "$payload_b64" ]; then
      log_error "Deploy payload is empty"
      return 1
    fi

    printf '%s' "$payload_b64" | base64 --decode > "$target_path"
    printf '%s\n' "$target_path"
  }

  deploy_payload_get() {
    local payload_path="$1"
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
    ' "$payload_path"
  }
else
  # shellcheck source=lib/deploy-payload.sh
  source "$DEPLOY_PAYLOAD_HELPER_PATH"
fi

if ! release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
  write_release_state_snapshot() {
    local snapshot_type="$1"
    local state_path="$2"
    local field=""
    local value=""

    mkdir -p "$(dirname "$state_path")"
    : > "$state_path"

    case "$snapshot_type" in
      current-runtime)
        while IFS= read -r field; do
          [ -z "$field" ] && continue
          value="${!field:-}"
          printf '%s=%q\n' "$field" "$value" >> "$state_path"
        done <<'EOF'
APP_SHA
IMAGE_SOURCE
CLASSROOMPATH_GATEWAY_IMAGE
CLASSROOMPATH_MIGRATIONS_IMAGE
OPENPATH_API_IMAGE
OPENPATH_VERSION
OPENPATH_LINUX_AGENT_VERSION
CLASSROOMPATH_SPA_IMAGE
EOF
        ;;
      deploy-context)
        while IFS= read -r field; do
          [ -z "$field" ] && continue
          value="${!field:-}"
          printf '%s=%q\n' "$field" "$value" >> "$state_path"
        done <<'EOF'
TARGET_SHA
APP_SHA
PREVIOUS_APP_SHA
IMAGE_SOURCE
MIGRATION_RISK_LEVEL
MIGRATION_CHANGED_FILES
MIGRATION_DESTRUCTIVE_FILES
PRODUCTION_BACKUP_REFERENCE
DB_MIGRATED
FAILURE_STAGE
DEPLOY_FAILURE_STAGE
ROLLBACK_ATTEMPTED
ROLLBACK_RESULT
EOF
        ;;
      *)
        log_error "Unsupported snapshot fallback: $snapshot_type"
        return 1
        ;;
    esac
  }

  write_current_release_state() {
    local state_path="$1"
    write_release_state_snapshot "current-runtime" "$state_path"
  }

  write_deploy_context_state() {
    local state_path="$1"
    write_release_state_snapshot "deploy-context" "$state_path"
  }
else
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

if ! release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
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
    local openpath_version="$7"
    local openpath_linux_agent_version="$8"
    local spa_image="$9"

    APP_SHA="$app_sha" \
    IMAGE_SOURCE="$image_source" \
    CLASSROOMPATH_GATEWAY_IMAGE="$gateway_image" \
    CLASSROOMPATH_MIGRATIONS_IMAGE="$migrations_image" \
    OPENPATH_API_IMAGE="$openpath_api_image" \
    OPENPATH_VERSION="$openpath_version" \
    OPENPATH_LINUX_AGENT_VERSION="$openpath_linux_agent_version" \
    CLASSROOMPATH_SPA_IMAGE="$spa_image" \
      write_current_release_state "$state_path"
  }
else
  # shellcheck source=lib/release-runtime.sh
  source "$RELEASE_RUNTIME_HELPER_PATH"
fi

STATE_DIR="/opt/classroompath/release-state"
CURRENT_STATE_FILE="$STATE_DIR/current-images.env"
PREVIOUS_STATE_FILE="$STATE_DIR/previous-images.env"
DEPLOY_CONTEXT_FILE="$STATE_DIR/staging-deploy-context.env"
mkdir -p "$STATE_DIR"

IMAGE_SOURCE="source-build"
RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
RESOLVED_OPENPATH_VERSION=""
RESOLVED_OPENPATH_LINUX_AGENT_VERSION=""
RESOLVED_SPA_IMAGE="classroompath-spa:local"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
DB_MIGRATED=0
FAILURE_STAGE="preflight"
ROLLBACK_ATTEMPTED=0
ROLLBACK_RESULT="not_attempted"
STAGING_DEPLOY_PAYLOAD_FILE=""
STAGING_RELEASE_MANIFEST_FILE=""

cleanup_staging_release_manifest() {
  rm -f "${STAGING_RELEASE_MANIFEST_FILE:-}" "${STAGING_DEPLOY_PAYLOAD_FILE:-}"
}

trap cleanup_staging_release_manifest EXIT

copy_release_state() {
  if [ -f "$CURRENT_STATE_FILE" ]; then
    cp "$CURRENT_STATE_FILE" "$PREVIOUS_STATE_FILE"
    PREVIOUS_APP_SHA="$(grep '^APP_SHA=' "$CURRENT_STATE_FILE" | cut -d= -f2- || true)"
  fi
}

write_release_state() {
  copy_release_state
  write_release_runtime_state \
    "$CURRENT_STATE_FILE" \
    "${STAGING_RELEASE_SHA:-origin-main}" \
    "$IMAGE_SOURCE" \
    "$RESOLVED_GATEWAY_IMAGE" \
    "$RESOLVED_MIGRATIONS_IMAGE" \
    "$RESOLVED_OPENPATH_API_IMAGE" \
    "$RESOLVED_OPENPATH_VERSION" \
    "$RESOLVED_OPENPATH_LINUX_AGENT_VERSION" \
    "$RESOLVED_SPA_IMAGE"
}

write_deploy_context() {
  APP_SHA="${STAGING_RELEASE_SHA:-origin-main}" \
  IMAGE_SOURCE="$IMAGE_SOURCE" \
  PREVIOUS_APP_SHA="${PREVIOUS_APP_SHA:-}" \
  MIGRATION_RISK_LEVEL="${MIGRATION_RISK_LEVEL:-safe}" \
  MIGRATION_CHANGED_FILES="${MIGRATION_CHANGED_FILES:-}" \
  MIGRATION_DESTRUCTIVE_FILES="${MIGRATION_DESTRUCTIVE_FILES:-}" \
  DB_MIGRATED="${DB_MIGRATED}" \
  FAILURE_STAGE="${FAILURE_STAGE}" \
  ROLLBACK_ATTEMPTED="${ROLLBACK_ATTEMPTED}" \
  ROLLBACK_RESULT="${ROLLBACK_RESULT}" \
    write_deploy_context_state "$DEPLOY_CONTEXT_FILE"
}

resolve_pulled_digest() {
  local image_ref="$1"
  local repo_digest=""
  repo_digest="$(docker image inspect "$image_ref" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  if [ -n "$repo_digest" ]; then
    printf '%s' "$repo_digest"
    return
  fi

  printf '%s' "$image_ref"
}

classify_migration_risk() {
  eval "$(node "$SCRIPT_DIR/classify-migration-risk.mjs" --repo-root "$APP_DIR" --from "$PREVIOUS_APP_SHA" --to "${STAGING_RELEASE_SHA:-origin/main}")"
}

restore_previous_release_state() {
  if [ ! -f "$PREVIOUS_STATE_FILE" ]; then
    log_warn "No previous release metadata available; cannot restore previous release"
    ROLLBACK_RESULT="unavailable"
    write_deploy_context
    return 1
  fi

  log_warn "Attempting to restore previous staging release state..."
  ROLLBACK_ATTEMPTED=1
  write_deploy_context

  set -a
  . "$PREVIOUS_STATE_FILE"
  set +a

  git checkout --detach "$APP_SHA"
  git reset --hard "$APP_SHA"
  git submodule sync --recursive
  git submodule update --init --recursive --force

  cd "$APP_DIR/docker"
  export COMPOSE_PROJECT_NAME=classroompath-staging

  if [ "${IMAGE_SOURCE:-source-build}" = "release-candidate" ]; then
    export CLASSROOMPATH_GATEWAY_IMAGE
    export CLASSROOMPATH_MIGRATIONS_IMAGE
    export OPENPATH_API_IMAGE
    export CLASSROOMPATH_SPA_IMAGE
    upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"
    upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"
    docker compose pull gateway api spa
    compose_up_force_recreate_no_build
  else
    remove_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION
    remove_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION
    unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE
    docker compose build
    docker compose up -d --force-recreate
  fi

  cp "$PREVIOUS_STATE_FILE" "$CURRENT_STATE_FILE"
  ROLLBACK_RESULT="success"
  write_deploy_context
  return 0
}

fail_after_migrations() {
  local message="$1"
  log_error "$message"
  if restore_previous_release_state; then
    log_warn "Previous staging release restored after failure"
  else
    log_error "Failed to restore previous staging release"
  fi
  exit 1
}

compose_up_force_recreate_no_build() {
  local compose_output=""
  local compose_exit_code=0

  set +e
  compose_output="$(docker compose up -d --force-recreate --no-build 2>&1)"
  compose_exit_code=$?
  set -e

  if [ "$compose_exit_code" -eq 0 ]; then
    printf '%s\n' "$compose_output"
    return 0
  fi

  printf '%s\n' "$compose_output" >&2

  if printf '%s\n' "$compose_output" | grep -q "No such container"; then
    log_warn "docker compose reported a stale container reference; retrying once after cleanup..."
    docker compose down --remove-orphans 2>/dev/null || true
    docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
    docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
    docker compose up -d --force-recreate --no-build
    return $?
  fi

  return $compose_exit_code
}

deploy_with_release_candidates() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 1
  fi

  ensure_staging_release_candidate_runtime_env || return 1

  if [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ]; then
    log_error "Release candidate manifest is incomplete"
    return 1
  fi

  if [ -n "${STAGING_GHCR_TOKEN:-}" ]; then
    if [ -z "${STAGING_GHCR_USERNAME:-}" ]; then
      log_error "STAGING_GHCR_TOKEN is set but STAGING_GHCR_USERNAME is missing"
      return 1
    fi

    echo "$STAGING_GHCR_TOKEN" | docker login ghcr.io -u "$STAGING_GHCR_USERNAME" --password-stdin
  fi

  export COMPOSE_PROJECT_NAME=classroompath-staging
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"

  log_info "Pulling release candidate migrations image for ${STAGING_RELEASE_SHA:-origin-main}..."
  docker pull "$CLASSROOMPATH_MIGRATIONS_IMAGE" || return 1

  log_info "Pulling release candidate images for ${STAGING_RELEASE_SHA:-origin-main}..."
  docker compose pull gateway api spa || return 1

  log_info "Starting staging from release candidate images..."
  docker compose down --remove-orphans 2>/dev/null || true
  docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  compose_up_force_recreate_no_build || return 1

  IMAGE_SOURCE="release-candidate"
  RESOLVED_GATEWAY_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_GATEWAY_IMAGE")"
  RESOLVED_MIGRATIONS_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_MIGRATIONS_IMAGE")"
  RESOLVED_OPENPATH_API_IMAGE="$(resolve_pulled_digest "$OPENPATH_API_IMAGE")"
  RESOLVED_OPENPATH_VERSION="${OPENPATH_VERSION:-}"
  RESOLVED_OPENPATH_LINUX_AGENT_VERSION="${OPENPATH_LINUX_AGENT_VERSION:-}"
  RESOLVED_SPA_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_SPA_IMAGE")"
  write_release_state
  return 0
}

ensure_staging_release_candidate_runtime_env() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 0
  fi

  if [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ]; then
    if [ -n "${STAGING_RELEASE_MANIFEST_FILE:-}" ] && [ -f "$STAGING_RELEASE_MANIFEST_FILE" ]; then
      load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE" "${STAGING_RELEASE_SHA:-}"
      STAGING_RELEASE_SHA="${RELEASE_MANIFEST_APP_SHA:-${STAGING_RELEASE_SHA:-}}"
    fi
  fi

  if [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ]; then
    log_error "Release candidate manifest did not export OpenPath runtime versions"
    return 1
  fi

  return 0
}

deploy_from_source() {
  log_info "Rebuilding containers from source..."
  export COMPOSE_PROJECT_NAME=classroompath-staging
  unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE
  remove_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION
  remove_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION
  RESOLVED_OPENPATH_VERSION=""
  RESOLVED_OPENPATH_LINUX_AGENT_VERSION=""

  docker compose down --remove-orphans 2>/dev/null || true
  docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true

  if ! docker compose build --quiet; then
    log_warn "Build failed in quiet mode; retrying with verbose output..."
    docker compose build || return 1
  fi

  docker compose up -d --force-recreate || return 1
  IMAGE_SOURCE="source-build"
  RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
  RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
  RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
  RESOLVED_SPA_IMAGE="classroompath-spa:local"
  write_release_state
  return 0
}

load_staging_release_manifest() {
  local release_manifest_b64=""
  local normalized_manifest_file=""

  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 0
  fi

  if [ -n "${STAGING_DEPLOY_PAYLOAD_B64:-}" ]; then
    STAGING_DEPLOY_PAYLOAD_FILE="$(mktemp)"
    decode_deploy_payload_base64 "$STAGING_DEPLOY_PAYLOAD_B64" "$STAGING_DEPLOY_PAYLOAD_FILE" >/dev/null
    release_manifest_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" manifest_base64)"
  else
    release_manifest_b64="$STAGING_RELEASE_MANIFEST_B64"
  fi

  STAGING_RELEASE_MANIFEST_FILE="$(mktemp)"
  decode_release_manifest_base64 "$STAGING_RELEASE_MANIFEST_B64" "$STAGING_RELEASE_MANIFEST_FILE" >/dev/null || true
  decode_release_manifest_base64 "$release_manifest_b64" "$STAGING_RELEASE_MANIFEST_FILE" >/dev/null
  normalized_manifest_file="$(mktemp)"
  node "$APP_DIR/scripts/lib/release-manifest.mjs" normalize \
    --file "$STAGING_RELEASE_MANIFEST_FILE" \
    --output-file "$normalized_manifest_file" \
    --sha "${STAGING_RELEASE_SHA:-}" \
    --repository "${STAGING_RELEASE_REPOSITORY:-}" \
    --run-id "${STAGING_RELEASE_RUN_ID:-}"
  mv "$normalized_manifest_file" "$STAGING_RELEASE_MANIFEST_FILE"
  load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"

  STAGING_RELEASE_SHA="$RELEASE_MANIFEST_APP_SHA"
}

prepare_staging_checkout() {
  cd "$APP_DIR"

  log_info "Fetching latest from origin..."
  git fetch origin main

  log_info "Resetting to origin/main..."
  git reset --hard origin/main

  log_info "Updating submodules..."
  git submodule sync --recursive
  git submodule update --init --recursive --force
  remote_deploy_reload_checked_out_helpers "$APP_DIR/scripts/lib/common.sh"
  log_info "Staging checkout is now at $(git rev-parse HEAD)"

  load_staging_release_manifest
  classify_migration_risk
  write_deploy_context
}

run_staging_runtime_validation() {
  log_info "Syncing billing runtime env..."
  bash scripts/sync-billing-env.sh "$APP_DIR/config/.env"

  log_info "Validating runtime config..."
  CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}" bash scripts/validate-runtime-config-docker.sh
}

run_staging_email_delivery_preflight() {
  log_info "Checking transactional email delivery..."
  CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}" bash scripts/check-email-delivery-docker.sh
}

cleanup_staging_disk_if_needed() {
  log_info "Checking disk space..."
  DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
  log_info "Current disk usage: ${DISK_USAGE}%"

  if [ "$DISK_USAGE" -gt 80 ]; then
    log_warn "Disk usage above 80%, running Docker cleanup..."
    docker system prune -af --volumes 2>/dev/null || true
    docker builder prune -af 2>/dev/null || true
    NEW_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
    log_info "Disk usage after cleanup: ${NEW_USAGE}%"
  fi
}

run_staging_database_migrations() {
  FAILURE_STAGE="migrations"
  write_deploy_context

  if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then
    log_info "Running database migrations from workspace sources..."
    bash scripts/run-migrations-docker.sh --cp --openpath || exit 1
  else
    if [ -z "${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" ]; then
      die "Release candidate migrations image ref is missing" 1
    fi

    log_info "Running database migrations from release candidate image..."
    bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE" || exit 1
  fi

  DB_MIGRATED=1
  FAILURE_STAGE="startup"
  write_deploy_context
}

start_staging_runtime() {
  cd "$APP_DIR/docker"

  plan_staging_runtime_deploy

  if ! apply_staging_runtime_deploy; then
    fail_after_migrations "$STAGING_DEPLOY_FAILURE_MESSAGE"
  fi
}

plan_staging_runtime_deploy() {
  if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then
    STAGING_DEPLOY_PLAN="source-build"
    STAGING_DEPLOY_FAILURE_MESSAGE="Staging source deployment failed after migrations"
    return 0
  fi

  STAGING_DEPLOY_PLAN="release-candidate"
  STAGING_DEPLOY_FAILURE_MESSAGE="Staging release-candidate deploy failed after migrations"
}

apply_staging_runtime_deploy() {
  case "${STAGING_DEPLOY_PLAN:-}" in
    source-build)
      deploy_from_source
      ;;
    release-candidate)
      deploy_with_release_candidates
      ;;
    *)
      die "Unknown staging deploy plan: ${STAGING_DEPLOY_PLAN:-unset}" 1
      ;;
  esac
}

wait_for_staging_runtime_readiness() {
  log_info "Containers started from ${IMAGE_SOURCE}, waiting for health..."

  if ! timeout 60 bash -c 'until docker compose ps | grep -q "healthy"; do sleep 2; done'; then
    docker compose ps
    fail_after_migrations "Timeout waiting for staging health checks"
  fi

  for i in 1 2 3 4 5; do
    if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
      log_success "Gateway health check passed"
      break
    fi

    if [ "$i" -eq 5 ]; then
      docker logs classroompath-gateway --tail 30
      fail_after_migrations "Gateway health checks failed after deployment"
    fi

    log_warn "Health check attempt $i failed, retrying..."
    sleep 5
  done

  FAILURE_STAGE="readiness"
  write_deploy_context

  local ready_check=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ready_check=$(curl -sS http://localhost:3001/cp/ready 2>/dev/null || true)
    if [ -z "$ready_check" ]; then
      ready_check='{"ready":false}'
    fi

    if echo "$ready_check" | grep -q '"ready":true'; then
      log_success "Application readiness OK"
      FAILURE_STAGE="completed"
      write_deploy_context
      return 0
    fi

    if [ "$i" -lt 12 ]; then
      log_warn "Application not ready (attempt $i/12), waiting 5s..."
      sleep 5
    else
      log_error "Readiness response: $ready_check"
      docker logs classroompath-gateway --tail 50 || true
      docker logs classroompath-api --tail 50 || true
      fail_after_migrations "Application readiness failed after staging deployment"
    fi
  done
}

run_remote_deploy_phases \
  prepare_staging_checkout \
  run_staging_runtime_validation \
  run_staging_email_delivery_preflight \
  cleanup_staging_disk_if_needed \
  run_staging_database_migrations \
  start_staging_runtime \
  wait_for_staging_runtime_readiness
