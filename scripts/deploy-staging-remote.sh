#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/opt/classroompath/app"
STATE_DIR="/opt/classroompath/release-state"
mkdir -p "$STATE_DIR"

IMAGE_SOURCE="source-build"
RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
RESOLVED_SPA_IMAGE="classroompath-spa:local"

copy_release_state() {
    if [ -f "$STATE_DIR/current-images.env" ]; then
        cp "$STATE_DIR/current-images.env" "$STATE_DIR/previous-images.env"
    fi
}

write_release_state() {
    copy_release_state
    cat > "$STATE_DIR/current-images.env" <<EOF
APP_SHA=${STAGING_RELEASE_SHA:-origin-main}
IMAGE_SOURCE=$IMAGE_SOURCE
CLASSROOMPATH_GATEWAY_IMAGE=$RESOLVED_GATEWAY_IMAGE
CLASSROOMPATH_MIGRATIONS_IMAGE=$RESOLVED_MIGRATIONS_IMAGE
OPENPATH_API_IMAGE=$RESOLVED_OPENPATH_API_IMAGE
CLASSROOMPATH_SPA_IMAGE=$RESOLVED_SPA_IMAGE
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

deploy_with_release_candidates() {
    if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" != "1" ]; then
        return 1
    fi

    if [ -z "${STAGING_GATEWAY_IMAGE:-}" ] || [ -z "${STAGING_MIGRATIONS_IMAGE:-}" ] || [ -z "${STAGING_OPENPATH_API_IMAGE:-}" ] || [ -z "${STAGING_SPA_IMAGE:-}" ]; then
        echo "[DEPLOY] Release candidate image refs are incomplete"
        return 1
    fi

    if [ -n "${STAGING_GHCR_TOKEN:-}" ]; then
        if [ -z "${STAGING_GHCR_USERNAME:-}" ]; then
            echo "[DEPLOY] STAGING_GHCR_TOKEN is set but STAGING_GHCR_USERNAME is missing"
            return 1
        fi

        echo "$STAGING_GHCR_TOKEN" | docker login ghcr.io -u "$STAGING_GHCR_USERNAME" --password-stdin
    fi

    export COMPOSE_PROJECT_NAME=classroompath-staging
    export CLASSROOMPATH_GATEWAY_IMAGE="$STAGING_GATEWAY_IMAGE"
    export CLASSROOMPATH_MIGRATIONS_IMAGE="$STAGING_MIGRATIONS_IMAGE"
    export OPENPATH_API_IMAGE="$STAGING_OPENPATH_API_IMAGE"
    export CLASSROOMPATH_SPA_IMAGE="$STAGING_SPA_IMAGE"

    echo "[DEPLOY] Pulling release candidate migrations image for ${STAGING_RELEASE_SHA:-origin-main}..."
    if ! docker pull "$CLASSROOMPATH_MIGRATIONS_IMAGE"; then
        echo "[DEPLOY] Pulling release candidate migrations image failed"
        return 1
    fi

    echo "[DEPLOY] Pulling release candidate images for ${STAGING_RELEASE_SHA:-origin-main}..."
    if ! docker compose pull gateway api spa; then
        echo "[DEPLOY] Pulling release candidate images failed"
        return 1
    fi

    echo "[DEPLOY] Starting staging from release candidate images..."
    docker compose down --remove-orphans 2>/dev/null || true
    docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
    docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
    docker compose up -d --force-recreate --no-build

    IMAGE_SOURCE="release-candidate"
    RESOLVED_GATEWAY_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_GATEWAY_IMAGE")"
    RESOLVED_MIGRATIONS_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_MIGRATIONS_IMAGE")"
    RESOLVED_OPENPATH_API_IMAGE="$(resolve_pulled_digest "$OPENPATH_API_IMAGE")"
    RESOLVED_SPA_IMAGE="$(resolve_pulled_digest "$CLASSROOMPATH_SPA_IMAGE")"
    write_release_state
    return 0
}

deploy_from_source() {
    echo "[DEPLOY] Rebuilding containers from source..."
    export COMPOSE_PROJECT_NAME=classroompath-staging
    unset CLASSROOMPATH_GATEWAY_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE

    docker compose down --remove-orphans 2>/dev/null || true
    docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
    docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true

    if ! docker compose build --quiet; then
        echo "[DEPLOY] Build failed; retrying with verbose output..."
        docker compose build
    fi

    docker compose up -d --force-recreate
    IMAGE_SOURCE="source-build"
    RESOLVED_GATEWAY_IMAGE="classroompath-gateway:local"
    RESOLVED_MIGRATIONS_IMAGE="classroompath-migrations:local"
    RESOLVED_OPENPATH_API_IMAGE="classroompath-api:local"
    RESOLVED_SPA_IMAGE="classroompath-spa:local"
    write_release_state
}

cd "$APP_DIR"

echo "[DEPLOY] Fetching latest from origin..."
git fetch origin main

echo "[DEPLOY] Resetting to origin/main..."
git reset --hard origin/main

echo "[DEPLOY] Updating submodules..."
git submodule sync --recursive
git submodule update --init --recursive --force

echo "[DEPLOY] Validating runtime config..."
bash scripts/validate-runtime-config-docker.sh

cd "$APP_DIR"

echo "[DEPLOY] Checking disk space..."
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
echo "[DEPLOY] Current disk usage: ${DISK_USAGE}%"

if [ "$DISK_USAGE" -gt 80 ]; then
    echo "[DEPLOY] Disk usage above 80%, running Docker cleanup..."
    docker system prune -af --volumes 2>/dev/null || true
    docker builder prune -af 2>/dev/null || true
    NEW_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
    echo "[DEPLOY] Disk usage after cleanup: ${NEW_USAGE}%"
else
    echo "[DEPLOY] Disk usage OK, skipping cleanup"
fi

if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then
    echo "[DEPLOY] Running database migrations from workspace sources..."
    bash scripts/run-migrations-docker.sh --cp --openpath
    cd "$APP_DIR/docker"
    deploy_from_source
else
    if [ -z "${STAGING_MIGRATIONS_IMAGE:-}" ]; then
        echo "[DEPLOY] Release candidate migrations image ref is missing"
        exit 1
    fi

    export CLASSROOMPATH_MIGRATIONS_IMAGE="$STAGING_MIGRATIONS_IMAGE"
    echo "[DEPLOY] Running database migrations from release candidate image..."
    bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"
    cd "$APP_DIR/docker"
    if ! deploy_with_release_candidates; then
        echo "[DEPLOY] Release candidate deploy failed"
        exit 1
    fi
fi

echo "[DEPLOY] Containers started from ${IMAGE_SOURCE}, waiting for health..."
