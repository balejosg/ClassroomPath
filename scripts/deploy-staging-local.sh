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
STAGING_SMOKE_URL="${STAGING_SMOKE_URL:-https://classroompath-staging.duckdns.org}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"
APP_DIR="/opt/classroompath/app"

require_cmd git
require_cmd ssh
require_cmd npm

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

"${SSH_CMD[@]}" << 'DEPLOY_SCRIPT'
set -euo pipefail

APP_DIR="/opt/classroompath/app"
cd "$APP_DIR"

echo "[DEPLOY] Fetching latest from origin..."
git fetch origin main

echo "[DEPLOY] Resetting to origin/main..."
git reset --hard origin/main

echo "[DEPLOY] Updating submodules..."
git submodule sync --recursive
git submodule update --init --recursive --force

echo "[DEPLOY] Running database migrations..."
cd "$APP_DIR"

# Run schema pushes outside production containers.
# Uses Docker + npm workspaces to avoid per-package lockfile drift.
bash scripts/run-migrations-docker.sh --cp --openpath

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

echo "[DEPLOY] Rebuilding containers..."
cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-staging

docker compose down --remove-orphans 2>/dev/null || true
docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true

if ! docker compose build --quiet; then
    echo "[DEPLOY] Build failed; retrying with verbose output..."
    docker compose build
fi
docker compose up -d --force-recreate

echo "[DEPLOY] Containers started, waiting for health..."
DEPLOY_SCRIPT

log_success "Deploy commands executed"

# =============================================================================
# Step 3: Health checks (poll from remote, not local)
# =============================================================================
log_info "Running health checks..."

MAX_ATTEMPTS=30
ATTEMPT=0

# Check gateway health
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    
    HEALTH=$("${SSH_CMD[@]}" "curl -sf http://localhost:3000/cp/health 2>/dev/null" || echo "")
    
    if [ -n "$HEALTH" ]; then
        log_success "Gateway healthy (attempt $ATTEMPT)"
        break
    fi
    
    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        log_error "Gateway health check failed after $MAX_ATTEMPTS attempts"
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

# =============================================================================
# Step 4: Run smoke tests against staging
# =============================================================================
log_info "Running smoke tests against staging..."

cd "$SCRIPT_DIR/.."

SMOKE_TARGET_URL="$STAGING_SMOKE_URL"
SMOKE_SKIP_CORS="0"

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
npm run test:smoke 2>&1 | tee /tmp/smoke-results.txt

SMOKE_EXIT_CODE=${PIPESTATUS[0]}
set -e

if [ $SMOKE_EXIT_CODE -eq 0 ]; then
    log_success "Smoke tests passed"
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
echo "  Gateway: http://$STAGING_HOST:3001/cp/health"
echo "  API: http://$STAGING_HOST:3000/health"
echo ""
echo "  All smoke tests passed - deployment verified!"
echo ""

exit 0
