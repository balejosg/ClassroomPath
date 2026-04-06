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
RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"
DEPLOYMENT_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/deployment-state.sh")"

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

if [ -f "$RELEASE_STATE_HELPER_PATH" ]; then
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

if [ -f "$DEPLOYMENT_STATE_HELPER_PATH" ]; then
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

  deployment_state_load_previous_release() {
    if [ ! -f "$DEPLOYMENT_STATE_PREVIOUS_FILE" ]; then
      log_error "No previous release metadata available: $DEPLOYMENT_STATE_PREVIOUS_FILE"
      return 1
    fi

    set -a
    # shellcheck disable=SC1090
    . "$DEPLOYMENT_STATE_PREVIOUS_FILE"
    set +a
  }

  deployment_state_load_context() {
    if [ -f "$DEPLOYMENT_STATE_CONTEXT_FILE" ]; then
      set -a
      # shellcheck disable=SC1090
      . "$DEPLOYMENT_STATE_CONTEXT_FILE"
      set +a
    fi
  }

  deployment_state_activate_previous_release() {
    cp "$DEPLOYMENT_STATE_PREVIOUS_FILE" "$DEPLOYMENT_STATE_CURRENT_FILE"
  }
fi

DEPLOY_DIR="/opt/classroompath"
STATE_DIR="$DEPLOY_DIR/release-state"
deployment_state_init_paths "$STATE_DIR"
deployment_state_load_previous_release

if [ -z "${APP_SHA:-}" ] || [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ]; then
  log_error "Previous release metadata is incomplete"
  exit 1
fi

deployment_state_load_context
if [ -n "${MIGRATION_RISK_LEVEL:-}" ] || [ -n "${DB_MIGRATED:-}" ] || [ -n "${PRODUCTION_BACKUP_REFERENCE:-}" ]; then
  log_warn "Rollback context: migration risk=${MIGRATION_RISK_LEVEL:-unknown}, db_migrated=${DB_MIGRATED:-unknown}, backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
fi

cd "$APP_DIR"
git fetch origin --tags --prune
git fetch origin main --prune
git checkout --detach "$APP_SHA"
git reset --hard "$APP_SHA"
git submodule deinit -f --all || true
git submodule update --init --recursive --force
reload_deployed_common_helpers "$COMMON_SH_DEPLOYED_PATH"

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-production
upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"

log_info "Pulling previous immutable images for rollback..."
docker compose pull gateway api spa
log_info "Recreating containers from previous release state..."
docker compose up -d --force-recreate --no-build

deployment_state_activate_previous_release

for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
    log_success "Rollback health check passed"
    exit 0
  fi

  log_warn "Rollback health check attempt $i failed, retrying..."
  sleep 5
done

log_error "Rollback health check failed"
docker logs classroompath-gateway --tail 50
exit 1
