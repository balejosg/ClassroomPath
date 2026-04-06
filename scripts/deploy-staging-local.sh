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
# shellcheck source=lib/release-manifest.sh
source "$SCRIPT_DIR/lib/release-manifest.sh"

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

cleanup_staging_local_temp_files() {
    rm -f "${STAGING_RELEASE_MANIFEST_FILE:-}" "${STAGING_RELEASE_PLAN_ENV_FILE:-}" "${STAGING_DEPLOY_PAYLOAD_ENV_FILE:-}" "${VERIFICATION_STATE_FILE:-}"
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
STAGING_HEALTH_CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-staging-health.sh"
STAGING_REMOTE_SCRIPT_PATH="$SCRIPT_DIR/deploy-staging-remote.sh"
STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"
STAGING_VERIFY_STATE_SCRIPT_PATH="$SCRIPT_DIR/persist-staging-verification-remote.sh"
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

STAGING_IMAGE_SOURCE="$STAGING_IMAGE_MODE"
STAGING_USE_RELEASE_CANDIDATE=0
STAGING_RELEASE_SHA=""
STAGING_RELEASE_RUN_ID=""
STAGING_RELEASE_MANIFEST_FILE=""
STAGING_RELEASE_MANIFEST_B64=""
STAGING_RELEASE_PLAN_ENV_FILE=""
STAGING_DEPLOY_PAYLOAD_ENV_FILE=""
STAGING_DEPLOY_PAYLOAD_B64=""
STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE="0"
VERIFICATION_STATE_FILE=""
trap cleanup_staging_local_temp_files EXIT

if [ "$STAGING_IMAGE_MODE" = "release-candidate" ] && [ "$REMOTE_SHA" != "unknown" ]; then
    require_cmd gh
    STAGING_RELEASE_MANIFEST_FILE="$(mktemp)"
    node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest \
        --sha "$REMOTE_SHA" \
        --timeout-seconds "$STAGING_RELEASE_WAIT_TIMEOUT_SECONDS" \
        --interval-seconds "$STAGING_RELEASE_POLL_SECONDS" \
        --output-file "$STAGING_RELEASE_MANIFEST_FILE" >/dev/null

elif [ "$STAGING_IMAGE_MODE" = "release-candidate" ]; then
    log_error "STAGING_IMAGE_MODE=release-candidate requires origin/main to be reachable"
    exit 1
else
    log_warn "STAGING_IMAGE_MODE=source-build skips release candidates and is intended only for debug or recovery"
fi

STAGING_RELEASE_PLAN_ENV_FILE="$(mktemp)"
PLAN_ARGS=(
    --image-mode "$STAGING_IMAGE_MODE"
    --remote-sha "$REMOTE_SHA"
)

if [ -n "$STAGING_RELEASE_MANIFEST_FILE" ]; then
    PLAN_ARGS+=(--manifest-file "$STAGING_RELEASE_MANIFEST_FILE")
fi

node "$SCRIPT_DIR/lib/release-plan.mjs" render-staging-env "${PLAN_ARGS[@]}" > "$STAGING_RELEASE_PLAN_ENV_FILE"

set -a
. "$STAGING_RELEASE_PLAN_ENV_FILE"
set +a

STAGING_DEPLOY_PAYLOAD_ENV_FILE="$(mktemp)"
node "$SCRIPT_DIR/lib/deploy-payload.mjs" render-env \
    --target-environment staging \
    --deploy-ref "refs/heads/main" \
    --deploy-sha "$REMOTE_SHA" \
    --manifest-base64 "$STAGING_RELEASE_MANIFEST_B64" > "$STAGING_DEPLOY_PAYLOAD_ENV_FILE"

set -a
. "$STAGING_DEPLOY_PAYLOAD_ENV_FILE"
set +a

if [ "$STAGING_USE_RELEASE_CANDIDATE" = "1" ]; then
    log_info "Staging will deploy release candidate images for $STAGING_RELEASE_SHA"
    if [ -n "$STAGING_RELEASE_RUN_ID" ]; then
        log_info "Release candidate workflow run: $STAGING_RELEASE_RUN_ID"
    fi
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

if [ ! -f "$STAGING_REMOTE_SCRIPT_PATH" ]; then
    log_error "Remote staging deploy script not found: $STAGING_REMOTE_SCRIPT_PATH"
    exit 1
fi

if [ ! -f "$STAGING_HEALTH_CHECK_SCRIPT_PATH" ]; then
    log_error "Staging health helper script not found: $STAGING_HEALTH_CHECK_SCRIPT_PATH"
    exit 1
fi

if [ ! -f "$STAGING_VERIFY_STATE_SCRIPT_PATH" ]; then
    log_error "Staging verification persistence script not found: $STAGING_VERIFY_STATE_SCRIPT_PATH"
    exit 1
fi

if [ ! -f "$STAGING_VERIFICATION_RUNNER_PATH" ]; then
    log_error "Staging verification runner script not found: $STAGING_VERIFICATION_RUNNER_PATH"
    exit 1
fi

remote_assignment() {
    local key="$1"
    local value="$2"
    printf '%s=%q ' "$key" "$value"
}

REMOTE_ENV_CMD="$(
    remote_assignment STAGING_IMAGE_MODE "$STAGING_IMAGE_MODE"
    remote_assignment STAGING_USE_RELEASE_CANDIDATE "$STAGING_USE_RELEASE_CANDIDATE"
    remote_assignment STAGING_RELEASE_SHA "$STAGING_RELEASE_SHA"
    remote_assignment STAGING_RELEASE_MANIFEST_B64 "$STAGING_RELEASE_MANIFEST_B64"
    remote_assignment STAGING_DEPLOY_PAYLOAD_B64 "$STAGING_DEPLOY_PAYLOAD_B64"
    remote_assignment STAGING_GHCR_USERNAME "$STAGING_GHCR_USERNAME"
    remote_assignment STAGING_GHCR_TOKEN "$STAGING_GHCR_TOKEN"
)"

"${SSH_CMD[@]}" "${REMOTE_ENV_CMD}bash -s" < "$STAGING_REMOTE_SCRIPT_PATH"

log_success "Deploy commands executed"

# =============================================================================
# Step 3: Health checks (poll from remote, not local)
# =============================================================================
log_info "Running health checks..."

if ! HEALTH_CHECK_OUTPUT="$(bash "$STAGING_HEALTH_CHECK_SCRIPT_PATH" "$STAGING_HOST" "${SSH_CMD[@]}" 2>&1)"; then
    printf '%s\n' "$HEALTH_CHECK_OUTPUT" >&2
    exit 1
fi

while IFS= read -r line; do
    [ -z "$line" ] && continue
    log_success "$line"
done <<< "$HEALTH_CHECK_OUTPUT"

STAGING_DEPLOY_IMAGE_SOURCE=$("${SSH_CMD[@]}" "awk -F= '/^IMAGE_SOURCE=/{print \$2}' /opt/classroompath/release-state/current-images.env 2>/dev/null || true")
if [ -n "$STAGING_DEPLOY_IMAGE_SOURCE" ]; then
    log_info "Staging image source: $STAGING_DEPLOY_IMAGE_SOURCE"
fi

# =============================================================================
# Step 4: Run smoke tests against staging
# =============================================================================
log_info "Running staging verification against staging..."

VERIFICATION_STATE_FILE="$(mktemp)"

# =============================================================================
# Step 5: Run release gate and persist staging verification evidence
# =============================================================================
STAGING_GATE_RESULT="skipped"

if [ "$STAGING_RUN_RELEASE_GATE" = "1" ]; then
    if ! bash "$STAGING_VERIFICATION_RUNNER_PATH" collect "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "$CANONICAL_STAGING_URL" "$STAGING_USE_RELEASE_CANDIDATE" "${SSH_CMD[@]}"; then
        exit 1
    fi

    set -a
    . "$VERIFICATION_STATE_FILE"
    set +a
    STAGING_GATE_RESULT="success"

    log_info "Persisting staging verification evidence..."

    VERIFY_STATE_ENV_CMD="$(
        remote_assignment STATE_DIR "$STATE_DIR"
        remote_assignment APP_DIR "$APP_DIR"
        remote_assignment STAGING_VERIFIED_AT "$STAGING_VERIFIED_AT"
        remote_assignment STAGING_SMOKE_STATUS "$STAGING_SMOKE_STATUS"
        remote_assignment STAGING_FIREFOX_RELEASE_ARTIFACTS "$STAGING_FIREFOX_RELEASE_ARTIFACTS"
        remote_assignment STAGING_WINDOWS_BOOTSTRAP_RESULT "$STAGING_WINDOWS_BOOTSTRAP_RESULT"
        remote_assignment STAGING_FIREFOX_POLICY_RESULT "$STAGING_FIREFOX_POLICY_RESULT"
        remote_assignment STAGING_FIREFOX_EXTENSION_ID "$STAGING_FIREFOX_EXTENSION_ID"
        remote_assignment STAGING_FIREFOX_RELEASE_VERSION "$STAGING_FIREFOX_RELEASE_VERSION"
        remote_assignment STAGING_FIREFOX_METADATA_SHA256 "$STAGING_FIREFOX_METADATA_SHA256"
        remote_assignment STAGING_FIREFOX_XPI_SHA256 "$STAGING_FIREFOX_XPI_SHA256"
    )"

    "${SSH_CMD[@]}" "${VERIFY_STATE_ENV_CMD}bash -s" < "$STAGING_VERIFY_STATE_SCRIPT_PATH"

    log_success "Staging verification evidence saved"
else
    log_warn "Skipping staging release gate because STAGING_RUN_RELEASE_GATE=$STAGING_RUN_RELEASE_GATE"
    log_warn "Production tag workflow will fail until staging verification evidence is refreshed"

    if ! bash "$STAGING_VERIFICATION_RUNNER_PATH" smoke "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "${SSH_CMD[@]}"; then
        exit 1
    fi

    set -a
    . "$VERIFICATION_STATE_FILE"
    set +a
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
echo "  Verification Status: $STAGING_SMOKE_STATUS"
echo "  Release Gate: $STAGING_GATE_RESULT"
if [ -n "${STAGING_DEPLOY_IMAGE_SOURCE:-}" ]; then
    echo "  Image Source: $STAGING_DEPLOY_IMAGE_SOURCE"
fi
echo "  Gateway: http://$STAGING_HOST:3001/cp/health"
echo "  API: http://$STAGING_HOST:3000/health"
if [ "$STAGING_SMOKE_STATUS" = "PASS_WITH_FALLBACK" ]; then
    echo "  Note: public-domain smoke required direct-IP fallback; rerun strict smoke before production promotion."
fi
echo ""
echo "  All smoke tests passed - deployment verified!"
echo ""

exit 0
