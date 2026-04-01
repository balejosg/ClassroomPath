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

log_info "Starting ClassroomPath Docker deployment..."

DEPLOY_DIR="/opt/classroompath"
STATE_DIR="$DEPLOY_DIR/release-state"
DEPLOY_CONTEXT_FILE="$STATE_DIR/deploy-context.env"
mkdir -p "$STATE_DIR"

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

DB_MIGRATED=0
DEPLOY_FAILURE_STAGE="preflight"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
PRODUCTION_BACKUP_REFERENCE=""

cd "$APP_DIR"

log_info "Pulling latest changes..."

git fetch origin --tags --prune
git fetch origin main --prune
git checkout -- . 2>/dev/null || true
git clean -fd 2>/dev/null || true

TARGET_SHA=""

if [[ "${DEPLOY_REF:-}" == refs/tags/* ]]; then
  TAG_NAME="${DEPLOY_REF#refs/tags/}"
  TARGET_SHA=$(git rev-parse "${TAG_NAME}^{commit}" 2>/dev/null || true)
  if [ -z "$TARGET_SHA" ]; then
    git fetch origin "refs/tags/${TAG_NAME}:refs/tags/${TAG_NAME}" || true
    TARGET_SHA=$(git rev-parse "${TAG_NAME}^{commit}" 2>/dev/null || true)
  fi
fi

if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA=$(git rev-parse "${DEPLOY_SHA}^{commit}" 2>/dev/null || true)
fi

if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA=$(git rev-parse origin/main)
fi

log_info "Deploying ClassroomPath commit: $TARGET_SHA"

if [ -f "$STATE_DIR/current-images.env" ]; then
  cp "$STATE_DIR/current-images.env" "$STATE_DIR/previous-images.env"
  PREVIOUS_APP_SHA="$(grep '^APP_SHA=' "$STATE_DIR/current-images.env" | cut -d= -f2- || true)"
fi

eval "$(node scripts/classify-migration-risk.mjs --repo-root "$APP_DIR" --from "$PREVIOUS_APP_SHA" --to "$TARGET_SHA")"

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

git checkout --detach "$TARGET_SHA"
git reset --hard "$TARGET_SHA"
git submodule deinit -f --all || true
git submodule update --init --recursive --force

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

DEPLOY_FAILURE_STAGE="migrations"
write_deploy_context
log_info "Running database migrations from the release candidate runner..."
bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"
DB_MIGRATED=1
DEPLOY_FAILURE_STAGE="startup"
write_deploy_context

cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-production

log_info "Pulling immutable release images..."
docker compose pull gateway api spa

log_info "Stopping existing containers..."
docker compose down --remove-orphans || true
docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
docker rm -f classroompath-production-api-1 classroompath-production-gateway-1 classroompath-production-spa-1 2>/dev/null || true

log_info "Starting containers from immutable images..."
docker compose up -d --force-recreate --no-build

cat > "$STATE_DIR/current-images.env" <<EOF
APP_SHA=$TARGET_SHA
IMAGE_SOURCE=release-candidate
CLASSROOMPATH_GATEWAY_IMAGE=$CLASSROOMPATH_GATEWAY_IMAGE
CLASSROOMPATH_MIGRATIONS_IMAGE=$CLASSROOMPATH_MIGRATIONS_IMAGE
OPENPATH_API_IMAGE=$OPENPATH_API_IMAGE
CLASSROOMPATH_SPA_IMAGE=$CLASSROOMPATH_SPA_IMAGE
EOF

echo "Waiting for services to be healthy..."
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
READY_CHECK=''
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  READY_CHECK=$(curl -sf http://localhost:3001/cp/ready 2>/dev/null || echo '{"ready":false}')
  if echo "$READY_CHECK" | grep -q '"ready":true'; then
    log_success "Application readiness OK"
    break
  fi

  if [ "$i" -lt 12 ]; then
    log_warn "Application not ready (attempt $i/12), waiting 5s..."
    sleep 5
  else
    log_error "APPLICATION READINESS FAILED after 12 attempts"
    log_error "Readiness response: $READY_CHECK"
    log_error "Code rollback can be attempted automatically; DB migrated=$DB_MIGRATED backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
    log_error "Debug: docker logs classroompath-gateway --tail 50"
    log_error "Debug: docker logs classroompath-api --tail 50"
    exit 1
  fi
done

DEPLOY_FAILURE_STAGE="completed"
write_deploy_context
log_success "Deployment successful"
docker logs classroompath-gateway --tail 5
