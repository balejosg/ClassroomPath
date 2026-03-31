#!/usr/bin/env bash

set -euo pipefail

echo "Starting ClassroomPath Docker deployment..."

DEPLOY_DIR="/opt/classroompath"
APP_DIR="$DEPLOY_DIR/app"
STATE_DIR="$DEPLOY_DIR/release-state"
mkdir -p "$STATE_DIR"

cd "$APP_DIR"

echo "Pulling latest changes..."

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

echo "Deploying ClassroomPath commit: $TARGET_SHA"

if [ -f "$STATE_DIR/current-images.env" ]; then
  cp "$STATE_DIR/current-images.env" "$STATE_DIR/previous-images.env"
fi

git checkout --detach "$TARGET_SHA"
git reset --hard "$TARGET_SHA"
git submodule deinit -f --all || true
git submodule update --init --recursive --force

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

echo "Running database migrations from the release candidate runner..."
bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"

cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-production

echo "Pulling immutable release images..."
docker compose pull gateway api spa

echo "Stopping existing containers..."
docker compose down --remove-orphans || true
docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
docker rm -f classroompath-production-api-1 classroompath-production-gateway-1 classroompath-production-spa-1 2>/dev/null || true

echo "Starting containers from immutable images..."
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
  echo "Warning: Timeout waiting for health checks"
  docker compose ps
}

for i in 1 2 3 4 5; do
  if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
    echo "Gateway health check passed"
    break
  fi
  echo "Health check attempt $i failed, retrying..."
  sleep 5
done

if ! curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
  echo "Gateway deployment failed. Check logs:"
  docker logs classroompath-gateway --tail 30
  exit 1
fi

echo "Checking full application readiness..."
READY_CHECK=''
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  READY_CHECK=$(curl -sf http://localhost:3001/cp/ready 2>/dev/null || echo '{"ready":false}')
  if echo "$READY_CHECK" | grep -q '"ready":true'; then
    echo "Application readiness OK"
    break
  fi

  if [ "$i" -lt 12 ]; then
    echo "Application not ready (attempt $i/12), waiting 5s..."
    sleep 5
  else
    echo "APPLICATION READINESS FAILED after 12 attempts"
    echo "Readiness response: $READY_CHECK"
    echo "Debug: docker logs classroompath-gateway --tail 50"
    echo "Debug: docker logs classroompath-api --tail 50"
    exit 1
  fi
done

echo "Deployment successful"
docker logs classroompath-gateway --tail 5
