#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

APP_DIR="/opt/classroompath/app"
STATE_DIR="/opt/classroompath/release-state"
CURRENT_STATE_FILE="$STATE_DIR/current-images.env"
PREVIOUS_STATE_FILE="$STATE_DIR/previous-images.env"
DEPLOY_CONTEXT_FILE="$STATE_DIR/staging-deploy-context.env"
mkdir -p "$STATE_DIR"

IMAGE_SOURCE="source-build"
RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
RESOLVED_SPA_IMAGE="classroompath-spa:local"
PREVIOUS_APP_SHA=""
MIGRATION_RISK_LEVEL="safe"
MIGRATION_CHANGED_FILES=""
MIGRATION_DESTRUCTIVE_FILES=""
DB_MIGRATED=0
FAILURE_STAGE="preflight"
ROLLBACK_ATTEMPTED=0
ROLLBACK_RESULT="not_attempted"

copy_release_state() {
  if [ -f "$CURRENT_STATE_FILE" ]; then
    cp "$CURRENT_STATE_FILE" "$PREVIOUS_STATE_FILE"
    PREVIOUS_APP_SHA="$(grep '^APP_SHA=' "$CURRENT_STATE_FILE" | cut -d= -f2- || true)"
  fi
}

write_release_state() {
  copy_release_state
  cat > "$CURRENT_STATE_FILE" <<EOF
APP_SHA=${STAGING_RELEASE_SHA:-origin-main}
IMAGE_SOURCE=$IMAGE_SOURCE
CLASSROOMPATH_GATEWAY_IMAGE=$RESOLVED_GATEWAY_IMAGE
CLASSROOMPATH_MIGRATIONS_IMAGE=$RESOLVED_MIGRATIONS_IMAGE
OPENPATH_API_IMAGE=$RESOLVED_OPENPATH_API_IMAGE
CLASSROOMPATH_SPA_IMAGE=$RESOLVED_SPA_IMAGE
EOF
}

write_deploy_context() {
  cat > "$DEPLOY_CONTEXT_FILE" <<EOF
APP_SHA=${STAGING_RELEASE_SHA:-origin-main}
PREVIOUS_APP_SHA=${PREVIOUS_APP_SHA:-}
IMAGE_SOURCE=$IMAGE_SOURCE
MIGRATION_RISK_LEVEL=${MIGRATION_RISK_LEVEL:-safe}
MIGRATION_CHANGED_FILES=${MIGRATION_CHANGED_FILES:-}
MIGRATION_DESTRUCTIVE_FILES=${MIGRATION_DESTRUCTIVE_FILES:-}
DB_MIGRATED=${DB_MIGRATED}
FAILURE_STAGE=${FAILURE_STAGE}
ROLLBACK_ATTEMPTED=${ROLLBACK_ATTEMPTED}
ROLLBACK_RESULT=${ROLLBACK_RESULT}
EOF
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
    docker compose pull gateway api spa
    docker compose up -d --force-recreate --no-build
  else
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

deploy_with_release_candidates() {
  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
    return 1
  fi

  if [ -z "${STAGING_GATEWAY_IMAGE:-}" ] || [ -z "${STAGING_MIGRATIONS_IMAGE:-}" ] || [ -z "${STAGING_OPENPATH_API_IMAGE:-}" ] || [ -z "${STAGING_SPA_IMAGE:-}" ]; then
    log_error "Release candidate image refs are incomplete"
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
  export CLASSROOMPATH_GATEWAY_IMAGE="$STAGING_GATEWAY_IMAGE"
  export CLASSROOMPATH_MIGRATIONS_IMAGE="$STAGING_MIGRATIONS_IMAGE"
  export OPENPATH_API_IMAGE="$STAGING_OPENPATH_API_IMAGE"
  export CLASSROOMPATH_SPA_IMAGE="$STAGING_SPA_IMAGE"

  log_info "Pulling release candidate migrations image for ${STAGING_RELEASE_SHA:-origin-main}..."
  docker pull "$CLASSROOMPATH_MIGRATIONS_IMAGE" || return 1

  log_info "Pulling release candidate images for ${STAGING_RELEASE_SHA:-origin-main}..."
  docker compose pull gateway api spa || return 1

  log_info "Starting staging from release candidate images..."
  docker compose down --remove-orphans 2>/dev/null || true
  docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  docker compose up -d --force-recreate --no-build || return 1

  IMAGE_SOURCE="release-candidate"
  RESOLVED_GATEWAY_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_GATEWAY_IMAGE")"
  RESOLVED_MIGRATIONS_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_MIGRATIONS_IMAGE")"
  RESOLVED_OPENPATH_API_IMAGE="$(resolve_pulled_digest "$OPENPATH_API_IMAGE")"
  RESOLVED_SPA_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_SPA_IMAGE")"
  write_release_state
  return 0
}

deploy_from_source() {
  log_info "Rebuilding containers from source..."
  export COMPOSE_PROJECT_NAME=classroompath-staging
  unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE

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

cd "$APP_DIR"

log_info "Fetching latest from origin..."
git fetch origin main

log_info "Resetting to origin/main..."
git reset --hard origin/main

log_info "Updating submodules..."
git submodule sync --recursive
git submodule update --init --recursive --force

classify_migration_risk
write_deploy_context

log_info "Validating runtime config..."
bash scripts/validate-runtime-config-docker.sh

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

if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then
  FAILURE_STAGE="migrations"
  write_deploy_context
  log_info "Running database migrations from workspace sources..."
  bash scripts/run-migrations-docker.sh --cp --openpath || exit 1
  DB_MIGRATED=1
  FAILURE_STAGE="startup"
  write_deploy_context
  cd "$APP_DIR/docker"
  if ! deploy_from_source; then
    fail_after_migrations "Staging source deployment failed after migrations"
  fi
else
  if [ -z "${STAGING_MIGRATIONS_IMAGE:-}" ]; then
    die "Release candidate migrations image ref is missing" 1
  fi

  export CLASSROOMPATH_MIGRATIONS_IMAGE="$STAGING_MIGRATIONS_IMAGE"
  FAILURE_STAGE="migrations"
  write_deploy_context
  log_info "Running database migrations from release candidate image..."
  bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE" || exit 1
  DB_MIGRATED=1
  FAILURE_STAGE="startup"
  write_deploy_context
  cd "$APP_DIR/docker"
  if ! deploy_with_release_candidates; then
    fail_after_migrations "Staging release-candidate deploy failed after migrations"
  fi
fi

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
READY_CHECK=''
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  READY_CHECK=$(curl -sf http://localhost:3001/cp/ready 2>/dev/null || echo '{"ready":false}')
  if echo "$READY_CHECK" | grep -q '"ready":true'; then
    log_success "Application readiness OK"
    FAILURE_STAGE="completed"
    write_deploy_context
    exit 0
  fi

  if [ "$i" -lt 12 ]; then
    log_warn "Application not ready (attempt $i/12), waiting 5s..."
    sleep 5
  else
    log_error "Readiness response: $READY_CHECK"
    docker logs classroompath-gateway --tail 50 || true
    docker logs classroompath-api --tail 50 || true
    fail_after_migrations "Application readiness failed after staging deployment"
  fi
done
