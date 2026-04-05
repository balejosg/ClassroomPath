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

COMMON_SH_PATH="$SCRIPT_DIR/lib/common.sh"
if [ ! -f "$COMMON_SH_PATH" ]; then
  COMMON_SH_PATH="$APP_DIR/scripts/lib/common.sh"
fi
RELEASE_MANIFEST_HELPER_PATH="$SCRIPT_DIR/lib/release-manifest.sh"
if [ ! -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then
  RELEASE_MANIFEST_HELPER_PATH="$APP_DIR/scripts/lib/release-manifest.sh"
fi
RELEASE_STATE_HELPER_PATH="$SCRIPT_DIR/lib/release-state.sh"
if [ ! -f "$RELEASE_STATE_HELPER_PATH" ]; then
  RELEASE_STATE_HELPER_PATH="$APP_DIR/scripts/lib/release-state.sh"
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

reload_deployed_common_helpers() {
  if [ -f "$COMMON_SH_DEPLOYED_PATH" ]; then
    # shellcheck disable=SC1090
    source "$COMMON_SH_DEPLOYED_PATH"
  fi
}

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"
# shellcheck source=lib/release-manifest.sh
source "$RELEASE_MANIFEST_HELPER_PATH"
# shellcheck source=lib/release-state.sh
source "$RELEASE_STATE_HELPER_PATH"

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
  reload_deployed_common_helpers
}

load_production_release_manifest() {
  RELEASE_MANIFEST_FILE="$(mktemp)"
  decode_release_manifest_base64 "$RELEASE_MANIFEST_B64" "$RELEASE_MANIFEST_FILE" >/dev/null
  release_manifest_validate_contract "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"
  export_release_manifest_runtime_env "$RELEASE_MANIFEST_FILE"
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

  APP_SHA="$TARGET_SHA" \
  IMAGE_SOURCE="release-candidate" \
  CLASSROOMPATH_GATEWAY_IMAGE="$CLASSROOMPATH_GATEWAY_IMAGE" \
  CLASSROOMPATH_MIGRATIONS_IMAGE="$CLASSROOMPATH_MIGRATIONS_IMAGE" \
  OPENPATH_API_IMAGE="$OPENPATH_API_IMAGE" \
  OPENPATH_LINUX_AGENT_VERSION=$OPENPATH_LINUX_AGENT_VERSION \
  CLASSROOMPATH_SPA_IMAGE="$CLASSROOMPATH_SPA_IMAGE" \
    write_current_release_state "$STATE_DIR/current-images.env"
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
