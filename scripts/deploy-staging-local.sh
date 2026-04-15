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
# shellcheck source=lib/staging-deploy-local-release.sh
source "$SCRIPT_DIR/lib/staging-deploy-local-release.sh"
# shellcheck source=lib/staging-deploy-local-runtime.sh
source "$SCRIPT_DIR/lib/staging-deploy-local-runtime.sh"
# shellcheck source=lib/staging-deploy-local-verify.sh
source "$SCRIPT_DIR/lib/staging-deploy-local-verify.sh"

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
STAGING_DEPLOYMENT_MODE="${STAGING_DEPLOYMENT_MODE:-}"
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

if [ -z "$STAGING_DEPLOYMENT_MODE" ]; then
    if [ "$STAGING_IMAGE_MODE" = "release-candidate" ]; then
        STAGING_DEPLOYMENT_MODE="promotion-eligible"
    else
        STAGING_DEPLOYMENT_MODE="debug"
    fi
fi

case "$STAGING_DEPLOYMENT_MODE" in
    promotion-eligible|debug)
        ;;
    *)
        log_error "Invalid STAGING_DEPLOYMENT_MODE: $STAGING_DEPLOYMENT_MODE"
        log_error "Allowed values: promotion-eligible, debug"
        exit 2
        ;;
esac

if [ "$STAGING_DEPLOYMENT_MODE" = "promotion-eligible" ] && [ "$STAGING_IMAGE_MODE" != "release-candidate" ]; then
    log_error "STAGING_DEPLOYMENT_MODE=promotion-eligible requires STAGING_IMAGE_MODE=release-candidate"
    exit 2
fi

log_info "Staging deployment to $STAGING_HOST"
echo ""

trap cleanup_staging_local_temp_files EXIT
prepare_staging_local_release_context

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

run_staging_local_remote_deploy

# =============================================================================
# Step 3: Health checks (poll from remote, not local)
# =============================================================================
run_staging_local_health_checks

# =============================================================================
# Step 4: Run smoke tests against staging
# =============================================================================
run_staging_local_verification
print_staging_local_summary

exit 0
