#!/usr/bin/env bash

set -euo pipefail

DEPLOY_DIR="/opt/classroompath"
APP_DIR="$DEPLOY_DIR/app"
STATE_DIR="$DEPLOY_DIR/release-state"
PREVIOUS_FILE="$STATE_DIR/previous-images.env"
CURRENT_FILE="$STATE_DIR/current-images.env"

if [ ! -f "$PREVIOUS_FILE" ]; then
  echo "No previous release metadata available for rollback"
  exit 1
fi

set -a
. "$PREVIOUS_FILE"
set +a

if [ -z "${APP_SHA:-}" ] || [ -z "${CLASSROOMPATH_GATEWAY_IMAGE:-}" ] || [ -z "${OPENPATH_API_IMAGE:-}" ] || [ -z "${CLASSROOMPATH_SPA_IMAGE:-}" ]; then
  echo "Previous release metadata is incomplete"
  exit 1
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

docker compose pull gateway api spa
docker compose up -d --force-recreate --no-build

cp "$PREVIOUS_FILE" "$CURRENT_FILE"

if ! curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
  echo "Rollback health check failed"
  docker logs classroompath-gateway --tail 50
  exit 1
fi

echo "Rollback completed successfully"
