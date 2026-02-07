#!/bin/bash
# deploy-staging-local.sh - Fast local staging deployment for agent workflows
# 
# Usage: npm run deploy:staging:local
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

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Timing
START_TIME=$(date +%s)

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Load .env.local if exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
if [ -f "$ENV_FILE" ]; then
    log_info "Loading $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
fi

# Configuration with defaults
STAGING_HOST="${STAGING_HOST:-192.168.1.114}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
APP_DIR="/opt/classroompath/app"

# Validate required env vars
if [ -z "$STAGING_SSH_KEY" ]; then
    log_error "STAGING_SSH_KEY not set"
    echo ""
    echo "Set it in .env.local or export:"
    echo "  export STAGING_SSH_KEY=~/.ssh/classroompath_staging"
    exit 1
fi

# Expand ~ in path
STAGING_SSH_KEY="${STAGING_SSH_KEY/#\~/$HOME}"

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
    echo ""
    read -t 5 -p "Continue anyway? [y/N] " -n 1 -r REPLY || REPLY="y"
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_error "Aborted. Commit and push your changes first."
        exit 1
    fi
fi

# Check if we're on main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    log_warn "Not on main branch (on: $CURRENT_BRANCH)"
    log_warn "Staging deploys origin/main regardless"
fi

# Check if local is pushed
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "unknown")

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

SSH_CMD="ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i $STAGING_SSH_KEY -p $STAGING_PORT $STAGING_USER@$STAGING_HOST"

# Test connection
if ! $SSH_CMD "echo 'connected'" > /dev/null 2>&1; then
    log_error "Cannot connect to $STAGING_HOST"
    log_error "Check: STAGING_HOST, STAGING_SSH_KEY, network connectivity"
    exit 1
fi

log_success "Connected to staging"
log_info "Deploying..."

$SSH_CMD << 'DEPLOY_SCRIPT'
set -e

APP_DIR="/opt/classroompath/app"
cd "$APP_DIR"

echo "[DEPLOY] Fetching latest from origin..."
git fetch origin main

echo "[DEPLOY] Resetting to origin/main..."
git reset --hard origin/main

echo "[DEPLOY] Updating submodules..."
git submodule deinit -f --all 2>/dev/null || true
git submodule update --init --recursive --force

echo "[DEPLOY] Running database migrations..."
cd "$APP_DIR"
# Clean and reinstall for migrations
docker run --rm -v "$APP_DIR/api:/app" -w /app node:20-alpine sh -c "rm -rf node_modules && mkdir -p node_modules" 2>/dev/null || true
docker run --rm \
    -v "$APP_DIR/api:/app" \
    -v "$APP_DIR/config/.env:/app/.env:ro" \
    -w /app \
    --env-file "$APP_DIR/config/.env" \
    node:20-alpine \
    sh -c "npm install --silent && npm run db:push" 2>&1 | tail -5

echo "[DEPLOY] Rebuilding containers..."
cd "$APP_DIR/docker"
export COMPOSE_PROJECT_NAME=classroompath-staging

docker compose down --remove-orphans 2>/dev/null || true
docker rm -f classroompath-staging-api-1 classroompath-staging-gateway-1 classroompath-staging-spa-1 2>/dev/null || true
docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true

docker compose build --quiet
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
    
    HEALTH=$($SSH_CMD "curl -sf http://localhost:3001/cp/health 2>/dev/null" || echo "")
    
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
API_HEALTH=$($SSH_CMD "curl -sf http://localhost:3001/health 2>/dev/null" || echo "")

if echo "$API_HEALTH" | grep -q '"status":"ok"'; then
    log_success "API healthy (via gateway)"
else
    log_error "API health check failed"
    log_error "Response: $API_HEALTH"
    log_error "Debug: ssh deploy@$STAGING_HOST 'docker logs classroompath-api --tail 30'"
    exit 1
fi

# =============================================================================
# Step 4: Run smoke tests against staging
# =============================================================================
log_info "Running smoke tests against staging..."

cd "$SCRIPT_DIR/.."

# Run smoke tests with staging URL
SMOKE_TEST_URL="https://classroompath-staging.duckdns.org" \
SMOKE_TEST_TIMEOUT="15000" \
npm run test:smoke 2>&1 | tee /tmp/smoke-results.txt

SMOKE_EXIT_CODE=${PIPESTATUS[0]}

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
    echo "  curl -v https://classroompath-staging.duckdns.org/health"
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
echo "  URL: https://classroompath-staging.duckdns.org"
echo "  Gateway: http://$STAGING_HOST:3001/cp/health"
echo "  API: http://$STAGING_HOST:3000/health"
echo ""
echo "  All smoke tests passed - deployment verified!"
echo ""

exit 0
