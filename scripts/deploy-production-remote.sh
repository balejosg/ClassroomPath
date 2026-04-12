#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/opt/classroompath/app"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
COMMON_SH_DEPLOYED_PATH="$APP_DIR/scripts/lib/common.sh"

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
    RELEASE_STATE_COMPAT_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-state-compat.sh")"
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

    REMOTE_HELPER_CONTRACTS_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/remote-helper-contracts.sh")"
    if [ -f "$REMOTE_HELPER_CONTRACTS_PATH" ]; then
      # shellcheck disable=SC1090
      source "$REMOTE_HELPER_CONTRACTS_PATH"
    fi

    refresh_deployed_release_helpers
  }
fi

remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"
remote_deploy_init_production_helper_paths "$SCRIPT_DIR" "$APP_DIR"

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

  release_state_compat_helper_supports_contract() {
    local helper_path="${1:-}"
    remote_helper_path_supports_all "$helper_path" 'write_release_state_snapshot_compat()' 'release_state_list_fields_compat()'
  }

  deployment_state_helper_supports_contract() {
    local helper_path="${1:-}"
    remote_helper_path_supports_all "$helper_path" 'deployment_state_capture_previous_release()' 'deployment_state_activate_previous_release()'
  }

  release_runtime_helper_supports_runtime_contract() {
    local helper_path="${1:-}"
    remote_helper_path_supports_all "$helper_path" 'write_release_runtime_state()' 'OPENPATH_LINUX_AGENT_VERSION'
  }

  refresh_deployed_release_helpers() {
    RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")"
    RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
    RELEASE_STATE_COMPAT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state-compat.sh")"
    DEPLOYMENT_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-state.sh")"
    RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"

    if release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_MANIFEST_HELPER_PATH"
    fi

    if release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_STATE_HELPER_PATH"
    elif release_state_compat_helper_supports_contract "$RELEASE_STATE_COMPAT_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_STATE_COMPAT_HELPER_PATH"
    fi

    if deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$DEPLOYMENT_STATE_HELPER_PATH"
    fi

    if release_runtime_helper_supports_runtime_contract "$RELEASE_RUNTIME_HELPER_PATH"; then
      # shellcheck disable=SC1090
      source "$RELEASE_RUNTIME_HELPER_PATH"
    fi
  }
fi

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
  if [ -f "$RELEASE_STATE_COMPAT_HELPER_PATH" ]; then
    # shellcheck source=lib/release-state-compat.sh
    source "$RELEASE_STATE_COMPAT_HELPER_PATH"
  else
    write_release_state_snapshot_compat() {
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
  fi
else
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

if deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"; then
  # shellcheck source=lib/deployment-state.sh
  source "$DEPLOYMENT_STATE_HELPER_PATH"
else
  deployment_state_init_paths() {
    local state_dir="$1"
    DEPLOYMENT_STATE_DIR="$state_dir"
    DEPLOYMENT_STATE_CURRENT_FILE="$state_dir/current-images.env"
    DEPLOYMENT_STATE_PREVIOUS_FILE="$state_dir/previous-images.env"
    DEPLOYMENT_STATE_CONTEXT_FILE="$state_dir/deploy-context.env"
  }

  deployment_state_capture_previous_release() {
    if [ -f "$DEPLOYMENT_STATE_CURRENT_FILE" ]; then
      cp "$DEPLOYMENT_STATE_CURRENT_FILE" "$DEPLOYMENT_STATE_PREVIOUS_FILE"
      PREVIOUS_APP_SHA="$(awk -F= '/^APP_SHA=/{print $2}' "$DEPLOYMENT_STATE_CURRENT_FILE" | head -1)"
    fi
  }
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

    if declare -F write_release_state_snapshot_compat >/dev/null; then
      APP_SHA="$app_sha" \
      IMAGE_SOURCE="$image_source" \
      CLASSROOMPATH_GATEWAY_IMAGE="$gateway_image" \
      CLASSROOMPATH_MIGRATIONS_IMAGE="$migrations_image" \
      OPENPATH_API_IMAGE="$openpath_api_image" \
      OPENPATH_VERSION="$openpath_version" \
      OPENPATH_LINUX_AGENT_VERSION="$openpath_linux_agent_version" \
      CLASSROOMPATH_SPA_IMAGE="$spa_image" \
        write_release_state_snapshot_compat "current-runtime" "$state_path"
    else
      APP_SHA="$app_sha" \
      IMAGE_SOURCE="$image_source" \
      CLASSROOMPATH_GATEWAY_IMAGE="$gateway_image" \
      CLASSROOMPATH_MIGRATIONS_IMAGE="$migrations_image" \
      OPENPATH_API_IMAGE="$openpath_api_image" \
      OPENPATH_VERSION="$openpath_version" \
      OPENPATH_LINUX_AGENT_VERSION="$openpath_linux_agent_version" \
      CLASSROOMPATH_SPA_IMAGE="$spa_image" \
        write_current_release_state "$state_path"
    fi
  }
else
  # shellcheck source=lib/release-runtime.sh
  source "$RELEASE_RUNTIME_HELPER_PATH"
fi

upsert_env_file_var() {
  local path="$1"
  local key="$2"
  local value="$3"
  local tmp_file=""

  mkdir -p "$(dirname "$path")"
  touch "$path"
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$path" > "$tmp_file"

  mv "$tmp_file" "$path"
}

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"
if [ -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then
  # shellcheck source=lib/release-manifest.sh
  source "$RELEASE_MANIFEST_HELPER_PATH"
fi
if [ -f "$RELEASE_STATE_HELPER_PATH" ]; then
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

log_info "Starting ClassroomPath Docker deployment..."

DEPLOY_DIR="/opt/classroompath"
STATE_DIR="$DEPLOY_DIR/release-state"
DEPLOY_CONTEXT_FILE="$STATE_DIR/deploy-context.env"
mkdir -p "$STATE_DIR"
deployment_state_init_paths "$STATE_DIR"

DB_MIGRATED=0
DEPLOY_FAILURE_STAGE="preflight"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
PRODUCTION_BACKUP_REFERENCE=""
RELEASE_MANIFEST_FILE=""
DEPLOY_PAYLOAD_FILE=""
RELEASE_MANIFEST_B64_FROM_PAYLOAD=""
TARGET_SHA=""
PRODUCTION_REGISTRY_LOGGED_IN=0

cleanup_production_deploy_artifacts() {
  rm -f "${RELEASE_MANIFEST_FILE:-}" "${DEPLOY_PAYLOAD_FILE:-}"
  if [ "${PRODUCTION_REGISTRY_LOGGED_IN:-0}" = "1" ]; then
    docker logout ghcr.io >/dev/null 2>&1 || true
  fi
}

trap cleanup_production_deploy_artifacts EXIT

login_production_registry() {
  if [ "${PRODUCTION_REGISTRY_LOGGED_IN:-0}" = "1" ]; then
    return 0
  fi

  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
  PRODUCTION_REGISTRY_LOGGED_IN=1
}

cleanup_production_disk_if_needed() {
  local disk_usage=""
  local new_usage=""

  log_info "Checking disk space..."
  disk_usage="$(df / | tail -1 | awk '{print $5}' | tr -d '%')"
  log_info "Current disk usage: ${disk_usage}%"

  if [ "$disk_usage" -gt 80 ]; then
    log_warn "Disk usage above 80%, running Docker cleanup..."
    docker system prune -af --volumes 2>/dev/null || true
    docker builder prune -af 2>/dev/null || true
    new_usage="$(df / | tail -1 | awk '{print $5}' | tr -d '%')"
    log_info "Disk usage after cleanup: ${new_usage}%"
  fi
}

load_production_deploy_payload() {
  local release_manifest_b64=""

  if [ -n "${DEPLOY_PAYLOAD_B64:-}" ]; then
    DEPLOY_PAYLOAD_FILE="$(mktemp)"
    decode_deploy_payload_base64 "$DEPLOY_PAYLOAD_B64" "$DEPLOY_PAYLOAD_FILE" >/dev/null
    TARGET_SHA="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" deploy_sha)"
    release_manifest_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" manifest_base64)"
    RELEASE_MANIFEST_B64_FROM_PAYLOAD="$release_manifest_b64"
  else
    TARGET_SHA="${DEPLOY_SHA:-}"
    RELEASE_MANIFEST_B64_FROM_PAYLOAD="${RELEASE_MANIFEST_B64:-}"
  fi
}

prepare_production_checkout() {
  cd "$APP_DIR"

  log_info "Pulling latest changes..."
  git fetch origin --tags --prune
  git fetch origin main --prune
  git checkout -- . 2>/dev/null || true
  git clean -fd 2>/dev/null || true

  if [[ "${DEPLOY_REF:-}" == refs/tags/* ]]; then
    local tag_name="${DEPLOY_REF#refs/tags/}"
    TARGET_SHA=$(git rev-parse "${tag_name}^{commit}" 2>/dev/null || true)
    if [ -z "$TARGET_SHA" ]; then
      git fetch origin "refs/tags/${tag_name}:refs/tags/${tag_name}" || true
      TARGET_SHA=$(git rev-parse "${tag_name}^{commit}" 2>/dev/null || true)
    fi
  fi

  if [ -z "$TARGET_SHA" ] && [ -n "${DEPLOY_SHA:-}" ]; then
    TARGET_SHA=$(git rev-parse "${DEPLOY_SHA}^{commit}" 2>/dev/null || true)
  fi

  if [ -z "$TARGET_SHA" ]; then
    TARGET_SHA=$(git rev-parse origin/main)
  fi

  log_info "Deploying ClassroomPath commit: $TARGET_SHA"

  git checkout --detach "$TARGET_SHA"
  git reset --hard "$TARGET_SHA"
  git submodule deinit -f --all || true
  git submodule update --init --recursive --force
  remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"
  log_info "Production checkout is now at $(git rev-parse HEAD)"

  DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-production-context.sh")"
  DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deploy-production-runtime.sh")"

  if [ ! -f "$DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH" ] || [ ! -f "$DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH" ]; then
    die "Missing production deploy helpers after checkout" 1
  fi

  # shellcheck source=lib/deploy-production-context.sh
  source "$DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH"
  # shellcheck source=lib/deploy-production-runtime.sh
  source "$DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH"
}

load_production_release_manifest() {
  # Helper contract: load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"
  load_production_release_manifest_impl "$@"
}

classify_production_migration_risk() {
  classify_production_migration_risk_impl "$@"
}

run_production_database_migrations() {
  DEPLOY_FAILURE_STAGE="migrations"
  write_deploy_context

  cleanup_production_disk_if_needed
  login_production_registry

  log_info "Checking transactional email delivery..."
  CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}" bash scripts/check-email-delivery-docker.sh

  log_info "Running database migrations from the release candidate runner..."
  bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"

  DB_MIGRATED=1
  DEPLOY_FAILURE_STAGE="startup"
  write_deploy_context
}

plan_production_runtime_deploy() {
  plan_production_runtime_deploy_impl "$@"
}

apply_production_runtime_deploy() {
  # Helper contract: write_release_runtime_state "$STATE_DIR/current-images.env"
  apply_production_runtime_deploy_impl "$@"
}

start_production_runtime() {
  start_production_runtime_impl "$@"
}

wait_for_production_runtime_readiness() {
  wait_for_production_runtime_readiness_impl "$@"
}


run_remote_deploy_phases \
  load_production_deploy_payload \
  prepare_production_checkout \
  load_production_release_manifest \
  classify_production_migration_risk \
  cleanup_production_disk_if_needed \
  run_production_database_migrations \
  start_production_runtime \
  wait_for_production_runtime_readiness
