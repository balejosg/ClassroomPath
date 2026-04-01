#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/opt/classroompath/app"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  SCRIPT_DIR="$APP_DIR/scripts"
fi

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DEPLOY_DIR="/opt/classroompath"
STATE_DIR="$DEPLOY_DIR/release-state"
PREVIOUS_FILE="$STATE_DIR/previous-images.env"
CURRENT_FILE="$STATE_DIR/current-images.env"
DEPLOY_CONTEXT_FILE="$STATE_DIR/deploy-context.env"

if [ ! -f "$PREVIOUS_FILE" ]; then
  log_error "No previous release metadata available for rollback"
  exit 1
fi

set -a
. "$PREVIOUS_FILE"
set +a

if [ -z "${APP_SHA:-}" ] || [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ]; then
  log_error "Previous release metadata is incomplete"
  exit 1
fi

if [ -f "$DEPLOY_CONTEXT_FILE" ]; then
  set -a
  . "$DEPLOY_CONTEXT_FILE"
  set +a
  log_warn "Rollback context: migration risk=${MIGRATION_RISK_LEVEL:-unknown}, db_migrated=${DB_MIGRATED:-unknown}, backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
fi

cd "$APP_DIR"
git fetch origin --tags --prune
git fetch origin main --prune
git checkout --detach "$APP_SHA"
git reset --hard "$APP_SHA"
git submodule deinit -f --all || true
git submodule update --init --recursive --force

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-production

log_info "Pulling previous immutable images for rollback..."
docker compose pull gateway api spa
log_info "Recreating containers from previous release state..."
docker compose up -d --force-recreate --no-build

cp "$PREVIOUS_FILE" "$CURRENT_FILE"

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
