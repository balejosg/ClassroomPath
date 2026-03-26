#!/bin/bash
# deploy-staging-local.sh - Fast local staging deployment for agent workflows
# 
# Usage: npm run deploy:staging
#        ./scripts/deploy-staging-local.sh
#
# Environment variables (set in .env.local or export):
#   STAGING_HOST     - IP of CT 114 (default: 192.168.1.114)
#   STAGING_USER     - SSH user (default: deploy)
#   STAGING_SSH_KEY  - Path to SSH private key (required)
#   STAGING_PORT     - SSH port (default: 22)
#
# Exit codes:
#   0 - Success
#   1 - Failure (check stdout for details)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  npm run deploy:staging
  bash scripts/deploy-staging-local.sh [--yes]

Options:
  --yes   Non-interactive mode; assume "yes" for prompts

Env:
  DEPLOY_ASSUME_YES=1  Same as --yes
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --yes|-y)
            DEPLOY_ASSUME_YES=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown argument: $1"
            usage
            exit 2
            ;;
    esac
done

# Normalize env toggle
DEPLOY_ASSUME_YES="${DEPLOY_ASSUME_YES:-0}"
export DEPLOY_ASSUME_YES

# Timing
START_TIME=$(date +%s)

# Load .env.local if exists
ENV_FILE="$SCRIPT_DIR/../.env.local"
load_env_file "$ENV_FILE" || true

# Configuration with defaults
STAGING_HOST="${STAGING_HOST:-192.168.1.114}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"
STAGING_IMAGE_MODE="${STAGING_IMAGE_MODE:-release-candidate}"
STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"
STAGING_RELEASE_WAIT_TIMEOUT_SECONDS="${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-900}"
STAGING_RELEASE_POLL_SECONDS="${STAGING_RELEASE_POLL_SECONDS:-10}"
STAGING_GHCR_USERNAME="${STAGING_GHCR_USERNAME:-}"
STAGING_GHCR_TOKEN="${STAGING_GHCR_TOKEN:-}"
APP_DIR="/opt/classroompath/app"
STATE_DIR="/opt/classroompath/release-state"

require_cmd git
require_cmd ssh
require_cmd npm
require_cmd node

CANONICAL_STAGING_URL="$(node "$SCRIPT_DIR/deploy-targets.mjs" get staging publicUrl)"
STAGING_SMOKE_URL="${STAGING_SMOKE_URL:-$CANONICAL_STAGING_URL}"

# Validate required env vars
if [ -z "${STAGING_SSH_KEY:-}" ]; then
    log_error "STAGING_SSH_KEY not set"
    echo ""
    echo "Set it in .env.local or export:"
    echo "  export STAGING_SSH_KEY=~/.ssh/classroompath_staging"
    exit 1
fi

# Expand ~ in path
STAGING_SSH_KEY="$(expand_tilde "$STAGING_SSH_KEY")"

if [ ! -f "$STAGING_SSH_KEY" ]; then
    log_error "SSH key not found: $STAGING_SSH_KEY"
    exit 1
fi

case "$STAGING_IMAGE_MODE" in
    release-candidate|source-build)
        ;;
    *)
        log_error "Invalid STAGING_IMAGE_MODE: $STAGING_IMAGE_MODE"
        log_error "Allowed values: release-candidate, source-build"
        exit 2
        ;;
esac

log_info "Staging deployment to $STAGING_HOST"
echo ""

# =============================================================================
# Step 1: Verify git state
# =============================================================================
log_info "Checking git state..."

cd "$SCRIPT_DIR/.."

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    log_warn "Uncommitted changes detected"
    log_warn "Staging will deploy origin/main, not local changes"

    if [ "$DEPLOY_ASSUME_YES" = "1" ]; then
        log_warn "DEPLOY_ASSUME_YES=1; continuing without prompt"
    elif confirm_with_timeout "Continue anyway?" 10; then
        :
    else
        if is_tty_stdin; then
            log_error "Aborted. Commit and push your changes first."
        else
            log_error "Aborted (non-interactive). Set DEPLOY_ASSUME_YES=1 to override."
        fi
        exit 1
    fi
fi

# Check if we're on main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    log_warn "Not on main branch (on: $CURRENT_BRANCH)"
    log_warn "Staging deploys origin/main regardless"
fi

# Check if local is pushed (ensure origin/main is up to date)
LOCAL_SHA=$(git rev-parse HEAD)

REMOTE_SHA="unknown"
if git remote get-url origin >/dev/null 2>&1; then
    git fetch origin main --quiet || true
    REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "unknown")
fi

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    log_warn "Local HEAD differs from origin/main"
    log_info "Local:  $LOCAL_SHA"
    log_info "Remote: $REMOTE_SHA"
fi

STAGING_USE_RELEASE_CANDIDATE=0
STAGING_RELEASE_SHA=""
STAGING_RELEASE_RUN_ID=""
STAGING_GATEWAY_IMAGE=""
STAGING_MIGRATIONS_IMAGE=""
STAGING_OPENPATH_API_IMAGE=""
STAGING_SPA_IMAGE=""

if [ "$STAGING_IMAGE_MODE" = "release-candidate" ] && [ "$REMOTE_SHA" != "unknown" ]; then
    require_cmd gh
    RELEASE_IMAGE_OUTPUT="$(node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest \
        --sha "$REMOTE_SHA" \
        --timeout-seconds "$STAGING_RELEASE_WAIT_TIMEOUT_SECONDS" \
        --interval-seconds "$STAGING_RELEASE_POLL_SECONDS")"

    while IFS='=' read -r key value; do
        case "$key" in
            run_id)
                STAGING_RELEASE_RUN_ID="$value"
                ;;
            gateway_image)
                STAGING_GATEWAY_IMAGE="$value"
                ;;
            migrations_image)
                STAGING_MIGRATIONS_IMAGE="$value"
                ;;
            openpath_api_image)
                STAGING_OPENPATH_API_IMAGE="$value"
                ;;
            spa_image)
                STAGING_SPA_IMAGE="$value"
                ;;
        esac
    done <<< "$RELEASE_IMAGE_OUTPUT"

    STAGING_USE_RELEASE_CANDIDATE=1
    STAGING_RELEASE_SHA="$REMOTE_SHA"
    log_info "Staging will deploy release candidate images for $STAGING_RELEASE_SHA"
    if [ -n "$STAGING_RELEASE_RUN_ID" ]; then
        log_info "Release candidate workflow run: $STAGING_RELEASE_RUN_ID"
    fi
elif [ "$STAGING_IMAGE_MODE" = "release-candidate" ]; then
    log_error "STAGING_IMAGE_MODE=release-candidate requires origin/main to be reachable"
    exit 1
else
    log_warn "STAGING_IMAGE_MODE=source-build skips release candidates and is intended only for debug or recovery"
fi

log_success "Git state checked"

# =============================================================================
# Step 2: SSH and deploy
# =============================================================================
log_info "Connecting to staging..."

SSH_CMD=(
    ssh
    -o "ConnectTimeout=10"
    -o "BatchMode=yes"
    -o "IdentitiesOnly=yes"
    -o "StrictHostKeyChecking=${STAGING_SSH_STRICT_HOSTKEY}"
    -i "$STAGING_SSH_KEY"
    -p "$STAGING_PORT"
    "${STAGING_USER}@${STAGING_HOST}"
)

# Test connection
if ! "${SSH_CMD[@]}" "echo connected" > /dev/null 2>&1; then
    log_error "Cannot connect to $STAGING_HOST"
    log_error "Check: STAGING_HOST, STAGING_SSH_KEY, network connectivity"
    exit 1
fi

log_success "Connected to staging"
log_info "Deploying..."

remote_assignment() {
    local key="$1"
    local value="$2"
    printf '%s=%q ' "$key" "$value"
}

REMOTE_ENV_CMD="$(
    remote_assignment STAGING_IMAGE_MODE "$STAGING_IMAGE_MODE"
    remote_assignment STAGING_USE_RELEASE_CANDIDATE "$STAGING_USE_RELEASE_CANDIDATE"
    remote_assignment STAGING_RELEASE_SHA "$STAGING_RELEASE_SHA"
    remote_assignment STAGING_GATEWAY_IMAGE "$STAGING_GATEWAY_IMAGE"
    remote_assignment STAGING_MIGRATIONS_IMAGE "$STAGING_MIGRATIONS_IMAGE"
    remote_assignment STAGING_OPENPATH_API_IMAGE "$STAGING_OPENPATH_API_IMAGE"
    remote_assignment STAGING_SPA_IMAGE "$STAGING_SPA_IMAGE"
    remote_assignment STAGING_GHCR_USERNAME "$STAGING_GHCR_USERNAME"
    remote_assignment STAGING_GHCR_TOKEN "$STAGING_GHCR_TOKEN"
)"

"${SSH_CMD[@]}" "${REMOTE_ENV_CMD}bash -s" << 'DEPLOY_SCRIPT'
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
DEPLOY_SCRIPT

log_success "Deploy commands executed"

# =============================================================================
# Step 3: Health checks (poll from remote, not local)
# =============================================================================
log_info "Running health checks..."

MAX_ATTEMPTS=30
ATTEMPT=0

# Check gateway readiness
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    
    HEALTH=$("${SSH_CMD[@]}" "curl -sf http://localhost:3000/cp/ready 2>/dev/null" || echo "")
    
    if [ -n "$HEALTH" ]; then
        log_success "Gateway ready (attempt $ATTEMPT)"
        break
    fi
    
    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        log_error "Gateway readiness check failed after $MAX_ATTEMPTS attempts"
        log_error "Debug: ssh deploy@$STAGING_HOST 'docker logs classroompath-gateway --tail 30'"
        exit 1
    fi
    
    sleep 1
done

# Check API health via gateway (API port 3000 is internal to Docker network only)
# The gateway proxies /health to the API
# Wait a bit for API to be fully ready
sleep 3

ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    
    API_HEALTH=$("${SSH_CMD[@]}" "curl -sf http://localhost:3000/health 2>/dev/null" || echo "")
    
    if echo "$API_HEALTH" | grep -q '"status":"ok"'; then
        log_success "API healthy (via gateway, attempt $ATTEMPT)"
        break
    fi
    
    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        log_error "API health check failed after $MAX_ATTEMPTS attempts"
        log_error "Response: $API_HEALTH"
        log_error "Debug: ssh deploy@$STAGING_HOST 'docker logs classroompath-api --tail 30'"
        exit 1
    fi
    
    sleep 1
done

STAGING_DEPLOY_IMAGE_SOURCE=$("${SSH_CMD[@]}" "awk -F= '/^IMAGE_SOURCE=/{print \$2}' /opt/classroompath/release-state/current-images.env 2>/dev/null || true")
if [ -n "$STAGING_DEPLOY_IMAGE_SOURCE" ]; then
    log_info "Staging image source: $STAGING_DEPLOY_IMAGE_SOURCE"
fi

# =============================================================================
# Step 4: Run smoke tests against staging
# =============================================================================
log_info "Running smoke tests against staging..."

cd "$SCRIPT_DIR/.."

SMOKE_TARGET_URL="$STAGING_SMOKE_URL"
SMOKE_SKIP_CORS="0"
STAGING_VERIFICATION_STATUS="PASS"

SMOKE_TARGET_HOST=$(printf '%s\n' "$SMOKE_TARGET_URL" | sed -E 's#^[A-Za-z]+://([^/:]+).*#\1#')

if [ -n "$SMOKE_TARGET_HOST" ] && ! getent hosts "$SMOKE_TARGET_HOST" >/dev/null 2>&1; then
    log_warn "Smoke URL host does not resolve locally: $SMOKE_TARGET_HOST"
    REMOTE_DNS_STATUS=$("${SSH_CMD[@]}" "getent hosts '$SMOKE_TARGET_HOST' >/dev/null 2>&1 && echo ok || echo fail")

    if [ "$REMOTE_DNS_STATUS" = "ok" ]; then
        log_warn "Host resolves on staging host but not locally; using direct IP fallback for local smoke runner"
    else
        log_warn "Host does not resolve on staging host either; likely DNS outage/missing record"
    fi

    SMOKE_TARGET_URL="http://$STAGING_HOST:3001"
    SMOKE_SKIP_CORS="1"
    STAGING_VERIFICATION_STATUS="PASS_WITH_FALLBACK"
    log_warn "Falling back smoke target to direct staging gateway: $SMOKE_TARGET_URL"
fi

log_info "Smoke target URL: $SMOKE_TARGET_URL"
if [ "$SMOKE_SKIP_CORS" = "1" ]; then
    log_warn "Strict CORS origin check disabled for fallback smoke run"
fi

# Run smoke tests with staging URL
set +e
SMOKE_TEST_URL="$SMOKE_TARGET_URL" \
SMOKE_TEST_TIMEOUT="15000" \
SMOKE_SKIP_CORS="$SMOKE_SKIP_CORS" \
SMOKE_ALLOW_MUTATIONS="1" \
npm run test:smoke 2>&1 | tee /tmp/smoke-results.txt

SMOKE_EXIT_CODE=${PIPESTATUS[0]}
set -e

if [ $SMOKE_EXIT_CODE -eq 0 ]; then
    log_success "Smoke tests passed"
    log_info "Verification status: $STAGING_VERIFICATION_STATUS"
    if [ "$STAGING_VERIFICATION_STATUS" = "PASS_WITH_FALLBACK" ]; then
        log_warn "Fallback mode used; rerun once public DNS recovers before cutting a production tag"
    fi
else
    log_error "Smoke tests FAILED (exit code: $SMOKE_EXIT_CODE)"
    log_error "Review output above for details"
    echo ""
    echo "Common issues:"
    echo "  - NPM reverse proxy not routing correctly"
    echo "  - CORS_ORIGINS missing staging domain"
    echo "  - Container started but not fully ready"
    echo ""
    echo "Debug commands:"
    echo "  ssh deploy@$STAGING_HOST 'docker logs classroompath-gateway --tail 50'"
    echo "  ssh deploy@$STAGING_HOST 'docker logs classroompath-api --tail 50'"
    echo "  curl -v $SMOKE_TARGET_URL/health"
    exit 1
fi

# =============================================================================
# Step 5: Run release gate and persist staging verification evidence
# =============================================================================
STAGING_GATE_RESULT="skipped"

if [ "$STAGING_RUN_RELEASE_GATE" = "1" ]; then
    log_info "Running release gate against staging..."

    set +e
    RELEASE_GATE_URL="$CANONICAL_STAGING_URL" \
    RELEASE_GATE_TIMEOUT="30000" \
    RELEASE_GATE_ALLOW_MUTATIONS="1" \
    npm run test:release-gate 2>&1 | tee /tmp/release-gate-results.txt

    GATE_EXIT_CODE=${PIPESTATUS[0]}
    set -e

    if [ $GATE_EXIT_CODE -ne 0 ]; then
        log_error "Release gate FAILED (exit code: $GATE_EXIT_CODE)"
        log_error "Staging was deployed, but promotion evidence was not recorded"
        exit 1
    fi

    STAGING_GATE_RESULT="success"
    log_success "Release gate passed"

    STAGING_VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    log_info "Verifying Firefox release artifacts inside classroompath-api..."

    "${SSH_CMD[@]}" \
      "docker exec classroompath-api test -f /app/firefox-extension/build/firefox-release/metadata.json && docker exec classroompath-api test -f /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi"

    STAGING_FIREFOX_RELEASE_ARTIFACTS="present"
    log_info "Persisting staging verification evidence..."

    "${SSH_CMD[@]}" \
      "STATE_DIR='$STATE_DIR' APP_DIR='$APP_DIR' STAGING_VERIFIED_AT='$STAGING_VERIFIED_AT' STAGING_SMOKE_STATUS='$STAGING_VERIFICATION_STATUS' STAGING_FIREFOX_RELEASE_ARTIFACTS='$STAGING_FIREFOX_RELEASE_ARTIFACTS' bash -s" <<'VERIFY_STATE'
set -euo pipefail

mkdir -p "$STATE_DIR"

if [ ! -f "$STATE_DIR/current-images.env" ]; then
    echo "current-images.env is missing"
    exit 1
fi

set -a
. "$STATE_DIR/current-images.env"
set +a

OPENPATH_SHA="$(git -C "$APP_DIR/upstream/openpath" rev-parse HEAD)"

cat > "$STATE_DIR/staging-verification.env" <<EOF
STAGING_VERIFIED_AT=$STAGING_VERIFIED_AT
STAGING_VERIFIED_BY=deploy-staging-local.sh
STAGING_VERIFIED_APP_SHA=${APP_SHA:-}
STAGING_VERIFIED_OPENPATH_SHA=${OPENPATH_SHA:-}
STAGING_VERIFIED_IMAGE_SOURCE=${IMAGE_SOURCE:-}
STAGING_VERIFIED_GATEWAY_IMAGE=${CLASSROOMPATH_GATEWAY_IMAGE:-}
STAGING_VERIFIED_MIGRATIONS_IMAGE=${CLASSROOMPATH_MIGRATIONS_IMAGE:-}
STAGING_VERIFIED_OPENPATH_API_IMAGE=${OPENPATH_API_IMAGE:-}
STAGING_VERIFIED_SPA_IMAGE=${CLASSROOMPATH_SPA_IMAGE:-}
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=present
STAGING_SMOKE_RESULT=success
STAGING_SMOKE_STATUS=$STAGING_SMOKE_STATUS
STAGING_RELEASE_GATE_RESULT=success
EOF
VERIFY_STATE

    log_success "Staging verification evidence saved"
else
    log_warn "Skipping staging release gate because STAGING_RUN_RELEASE_GATE=$STAGING_RUN_RELEASE_GATE"
    log_warn "Production tag workflow will fail until staging verification evidence is refreshed"
fi

# =============================================================================
# Done
# =============================================================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "========================================"
log_success "Staging deployment + smoke tests complete!"
echo "========================================"
echo ""
echo "  Duration: ${DURATION}s"
echo "  URL: $SMOKE_TARGET_URL"
echo "  Verification Status: $STAGING_VERIFICATION_STATUS"
echo "  Release Gate: $STAGING_GATE_RESULT"
if [ -n "${STAGING_DEPLOY_IMAGE_SOURCE:-}" ]; then
    echo "  Image Source: $STAGING_DEPLOY_IMAGE_SOURCE"
fi
echo "  Gateway: http://$STAGING_HOST:3001/cp/health"
echo "  API: http://$STAGING_HOST:3000/health"
if [ "$STAGING_VERIFICATION_STATUS" = "PASS_WITH_FALLBACK" ]; then
    echo "  Note: public-domain smoke required direct-IP fallback; rerun strict smoke before production promotion."
fi
echo ""
echo "  All smoke tests passed - deployment verified!"
echo ""

exit 0
