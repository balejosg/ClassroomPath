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

SCRIPT_DIR="$(resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE")"
COMMON_SH_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/common.sh")"
RELEASE_MANIFEST_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-manifest.sh")"
RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
RELEASE_RUNTIME_HELPER_PATH="$SCRIPT_DIR/lib/release-runtime.sh"
if [ ! -f "$RELEASE_RUNTIME_HELPER_PATH" ]; then
  RELEASE_RUNTIME_HELPER_PATH="$APP_DIR/scripts/lib/release-runtime.sh"
fi

if [ ! -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then
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
    local linux_agent_version=""
    local image_key=""
    local image_ref=""

    repository="$(release_manifest_require_key "$manifest_path" repository)" || return 1
    run_id="$(release_manifest_require_key "$manifest_path" run_id)" || return 1
    app_sha="$(release_manifest_require_key "$manifest_path" app_sha)" || return 1
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

if [ ! -f "$RELEASE_STATE_HELPER_PATH" ]; then
  write_current_release_state() {
    local state_path="$1"

    mkdir -p "$(dirname "$state_path")"

    cat > "$state_path" <<EOF
APP_SHA=${APP_SHA:-}
IMAGE_SOURCE=${IMAGE_SOURCE:-}
CLASSROOMPATH_GATEWAY_IMAGE=${CLASSROOMPATH_GATEWAY_IMAGE:-}
CLASSROOMPATH_MIGRATIONS_IMAGE=${CLASSROOMPATH_MIGRATIONS_IMAGE:-}
OPENPATH_API_IMAGE=${OPENPATH_API_IMAGE:-}
OPENPATH_LINUX_AGENT_VERSION=${OPENPATH_LINUX_AGENT_VERSION:-}
CLASSROOMPATH_SPA_IMAGE=${CLASSROOMPATH_SPA_IMAGE:-}
EOF
  }
else
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

if [ ! -f "$RELEASE_RUNTIME_HELPER_PATH" ]; then
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

classify_sql_migration_file() {
  local path="$1"

  if grep -Eiq '\b(DELETE[[:space:]]+FROM|TRUNCATE|DROP[[:space:]]+(TABLE|INDEX|COLUMN|CONSTRAINT))\b' "$path"; then
    printf '%s\n' "destructive"
    return 0
  fi

  if grep -Eiq '\bALTER[[:space:]]+TABLE\b' "$path" \
    && grep -Eiq '\b(DROP|ALTER[[:space:]]+COLUMN[[:space:][:alnum:]_"]*[[:space:]]+TYPE|SET[[:space:]]+DATA[[:space:]]+TYPE)\b' "$path"; then
    printf '%s\n' "destructive"
    return 0
  fi

  if grep -Eiq '\bUPDATE\b' "$path" && grep -Eiq '\bSET\b' "$path"; then
    printf '%s\n' "destructive"
    return 0
  fi

  if grep -Eiq '\b(CREATE[[:space:]]+TABLE|CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX)\b' "$path"; then
    printf '%s\n' "expand-contract"
    return 0
  fi

  if grep -Eiq '\bALTER[[:space:]]+TABLE\b' "$path" \
    && grep -Eiq '\bADD[[:space:]]+(COLUMN|CONSTRAINT)\b' "$path"; then
    printf '%s\n' "expand-contract"
    return 0
  fi

  printf '%s\n' "safe"
}

classify_migration_risk() {
  local repo_root="$1"
  local from_ref="$2"
  local to_ref="$3"
  local -a changed_files=()
  local -a destructive_files=()
  local -a expand_files=()
  local -a safe_files=()
  local file=""
  local risk="safe"

  if [ -z "$from_ref" ] || [ -z "$to_ref" ] || [ "$from_ref" = "$to_ref" ]; then
    MIGRATION_RISK_LEVEL="safe"
    MIGRATION_CHANGED_FILES=""
    MIGRATION_DESTRUCTIVE_FILES=""
    return 0
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    changed_files+=("$file")
  done < <(
    git -C "$repo_root" diff --name-only "${from_ref}..${to_ref}" -- \
      'api/drizzle/*.sql' \
      'upstream/openpath/api/drizzle/*.sql'
  )

  for file in "${changed_files[@]}"; do
    risk="$(classify_sql_migration_file "$repo_root/$file")"
    case "$risk" in
      destructive)
        destructive_files+=("$file")
        ;;
      expand-contract)
        expand_files+=("$file")
        ;;
      *)
        safe_files+=("$file")
        ;;
    esac
  done

  if [ "${#destructive_files[@]}" -gt 0 ]; then
    MIGRATION_RISK_LEVEL="destructive"
  elif [ "${#expand_files[@]}" -gt 0 ]; then
    MIGRATION_RISK_LEVEL="expand-contract"
  else
    MIGRATION_RISK_LEVEL="safe"
  fi

  MIGRATION_CHANGED_FILES="$(IFS=,; printf '%s' "${changed_files[*]}")"
  MIGRATION_DESTRUCTIVE_FILES="$(IFS=,; printf '%s' "${destructive_files[*]}")"
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

DB_MIGRATED=0
DEPLOY_FAILURE_STAGE="preflight"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
PRODUCTION_BACKUP_REFERENCE=""
RELEASE_MANIFEST_FILE=""
TARGET_SHA=""
PRODUCTION_REGISTRY_LOGGED_IN=0

cleanup_production_deploy_artifacts() {
  rm -f "${RELEASE_MANIFEST_FILE:-}"
  if [ "${PRODUCTION_REGISTRY_LOGGED_IN:-0}" = "1" ]; then
    docker logout ghcr.io >/dev/null 2>&1 || true
  fi
}

trap cleanup_production_deploy_artifacts EXIT

write_deploy_context() {
  cat > "$DEPLOY_CONTEXT_FILE" <<EOF
TARGET_SHA=$TARGET_SHA
PREVIOUS_APP_SHA=${PREVIOUS_APP_SHA:-}
MIGRATION_RISK_LEVEL=${MIGRATION_RISK_LEVEL:-safe}
MIGRATION_CHANGED_FILES=${MIGRATION_CHANGED_FILES:-}
MIGRATION_DESTRUCTIVE_FILES=${MIGRATION_DESTRUCTIVE_FILES:-}
PRODUCTION_BACKUP_REFERENCE=${PRODUCTION_BACKUP_REFERENCE:-}
DB_MIGRATED=${DB_MIGRATED:-0}
DEPLOY_FAILURE_STAGE=${DEPLOY_FAILURE_STAGE:-preflight}
EOF
}

login_production_registry() {
  if [ "${PRODUCTION_REGISTRY_LOGGED_IN:-0}" = "1" ]; then
    return 0
  fi

  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
  PRODUCTION_REGISTRY_LOGGED_IN=1
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

  if [ -z "$TARGET_SHA" ]; then
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
  reload_deployed_common_helpers "$COMMON_SH_DEPLOYED_PATH"
}

load_production_release_manifest() {
  RELEASE_MANIFEST_FILE="$(mktemp)"
  decode_release_manifest_base64 "$RELEASE_MANIFEST_B64" "$RELEASE_MANIFEST_FILE" >/dev/null
  load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"
}

classify_production_migration_risk() {
  if [ -f "$STATE_DIR/current-images.env" ]; then
    cp "$STATE_DIR/current-images.env" "$STATE_DIR/previous-images.env"
    PREVIOUS_APP_SHA="$(grep '^APP_SHA=' "$STATE_DIR/current-images.env" | cut -d= -f2- || true)"
  fi

  classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"

  if [ "$MIGRATION_RISK_LEVEL" = "destructive" ]; then
    log_warn "Destructive migration risk detected: ${MIGRATION_DESTRUCTIVE_FILES:-unknown files}"

    if [ -n "${PRODUCTION_DB_BACKUP_COMMAND:-}" ]; then
      log_info "Creating production backup using PRODUCTION_DB_BACKUP_COMMAND..."
      PRODUCTION_BACKUP_REFERENCE="$(sh -lc "$PRODUCTION_DB_BACKUP_COMMAND")"
    elif [ -n "${PRODUCTION_DB_BACKUP_ID:-}" ]; then
      PRODUCTION_BACKUP_REFERENCE="$PRODUCTION_DB_BACKUP_ID"
    else
      die "Destructive migrations require PRODUCTION_DB_BACKUP_ID or PRODUCTION_DB_BACKUP_COMMAND" 1
    fi

    if [ -z "$PRODUCTION_BACKUP_REFERENCE" ]; then
      die "Backup command did not return a backup identifier" 1
    fi

    log_info "Recorded production backup reference: $PRODUCTION_BACKUP_REFERENCE"
  fi

  write_deploy_context
}

run_production_database_migrations() {
  DEPLOY_FAILURE_STAGE="migrations"
  write_deploy_context

  login_production_registry

  log_info "Running database migrations from the release candidate runner..."
  bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"

  DB_MIGRATED=1
  DEPLOY_FAILURE_STAGE="startup"
  write_deploy_context
}

start_production_runtime() {
  plan_production_runtime_deploy
  apply_production_runtime_deploy
}

plan_production_runtime_deploy() {
  PRODUCTION_DEPLOY_PLAN="release-candidate"
}

apply_production_runtime_deploy() {
  cd "$APP_DIR/docker"
  export COMPOSE_PROJECT_NAME=classroompath-production
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "$OPENPATH_LINUX_AGENT_VERSION"

  login_production_registry

  log_info "Pulling immutable release images..."
  docker compose pull gateway api spa

  log_info "Stopping existing containers..."
  docker compose down --remove-orphans || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  docker rm -f classroompath-production-api-1 classroompath-production-gateway-1 classroompath-production-spa-1 2>/dev/null || true

  log_info "Starting containers from immutable images..."
  docker compose up -d --force-recreate --no-build

  if [ "${PRODUCTION_DEPLOY_PLAN:-}" != "release-candidate" ]; then
    die "Unknown production deploy plan: ${PRODUCTION_DEPLOY_PLAN:-unset}" 1
  fi

  write_release_runtime_state \
    "$STATE_DIR/current-images.env" \
    "$TARGET_SHA" \
    "release-candidate" \
    "$CLASSROOMPATH_GATEWAY_IMAGE" \
    "$CLASSROOMPATH_MIGRATIONS_IMAGE" \
    "$OPENPATH_API_IMAGE" \
    "$OPENPATH_LINUX_AGENT_VERSION" \
    "$CLASSROOMPATH_SPA_IMAGE"
}

wait_for_production_runtime_readiness() {
  log_info "Waiting for services to be healthy..."
  timeout 60 bash -c 'until docker compose ps | grep -q "healthy"; do sleep 2; done' || {
    log_warn "Timeout waiting for container health checks"
    docker compose ps
  }

  for i in 1 2 3 4 5; do
    if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
      log_success "Gateway health check passed"
      break
    fi
    log_warn "Health check attempt $i failed, retrying..."
    sleep 5
  done

  if ! curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
    log_error "Gateway deployment failed. Check logs:"
    docker logs classroompath-gateway --tail 30
    exit 1
  fi

  DEPLOY_FAILURE_STAGE="readiness"
  write_deploy_context
  log_info "Checking full application readiness..."

  local ready_check=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ready_check=$(curl -sf http://localhost:3001/cp/ready 2>/dev/null || echo '{"ready":false}')
    if echo "$ready_check" | grep -q '"ready":true'; then
      log_success "Application readiness OK"
      DEPLOY_FAILURE_STAGE="completed"
      write_deploy_context
      log_success "Deployment successful"
      docker logs classroompath-gateway --tail 5
      return 0
    fi

    if [ "$i" -lt 12 ]; then
      log_warn "Application not ready (attempt $i/12), waiting 5s..."
      sleep 5
    else
      log_error "APPLICATION READINESS FAILED after 12 attempts"
      log_error "Readiness response: $ready_check"
      log_error "Code rollback can be attempted automatically; DB migrated=$DB_MIGRATED backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
      log_error "Debug: docker logs classroompath-gateway --tail 50"
      log_error "Debug: docker logs classroompath-api --tail 50"
      exit 1
    fi
  done
}

prepare_production_checkout
load_production_release_manifest
classify_production_migration_risk
run_production_database_migrations
start_production_runtime
wait_for_production_runtime_readiness
