#!/bin/bash
# deploy-staging-local.sh - Fast local staging deployment for agent workflows
# 
# Usage: npm run deploy:staging
#        ./scripts/deploy-staging-local.sh
#
# Environment variables (set in .env.local or export):
#   STAGING_HOST     - Private deploy host (required)
#   STAGING_USER     - SSH user (required)
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
# shellcheck source=lib/github-token.sh
source "$SCRIPT_DIR/lib/github-token.sh"
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
    rm -f "${STAGING_RELEASE_MANIFEST_FILE:-}" "${STAGING_RELEASE_BUNDLE_RUNTIME_FILE:-}" "${STAGING_RELEASE_BUNDLE_OUTPUT_FILE:-}" "${STAGING_RELEASE_PLAN_ENV_FILE:-}" "${STAGING_DEPLOY_PAYLOAD_ENV_FILE:-}" "${VERIFICATION_STATE_FILE:-}"
    if [ -n "${STAGING_RELEASE_BUNDLE_DIR:-}" ]; then
        rm -rf "$STAGING_RELEASE_BUNDLE_DIR"
    fi
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
STAGING_HOST="${STAGING_HOST:-}"
STAGING_USER="${STAGING_USER:-}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"
STAGING_IMAGE_MODE="${STAGING_IMAGE_MODE:-release-candidate}"
STAGING_DEPLOYMENT_MODE="${STAGING_DEPLOYMENT_MODE:-}"
STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"
STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS="${STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS:-${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-3600}}"
STAGING_RELEASE_WAIT_TIMEOUT_SECONDS="${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-$STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS}"
STAGING_RELEASE_POLL_SECONDS="${STAGING_RELEASE_POLL_SECONDS:-10}"
STAGING_GHCR_USERNAME="${STAGING_GHCR_USERNAME:-}"
STAGING_GHCR_TOKEN="${STAGING_GHCR_TOKEN:-}"
STAGING_HEALTH_CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-staging-health.sh"
STAGING_REMOTE_SCRIPT_PATH="$SCRIPT_DIR/deploy-staging-remote.sh"
STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"
STAGING_VERIFY_STATE_SCRIPT_PATH="$SCRIPT_DIR/persist-staging-verification-remote.sh"
APP_DIR="/srv/classroompath/app"
STATE_DIR="/srv/classroompath/release-state"

require_cmd git
require_cmd ssh
require_cmd npm
require_cmd node
ensure_github_token_env

CANONICAL_STAGING_URL="$(node "$SCRIPT_DIR/deploy-targets.mjs" get staging publicUrl)"
STAGING_SMOKE_URL="${STAGING_SMOKE_URL:-$CANONICAL_STAGING_URL}"
STAGING_CONTAINER_PLATFORM="${STAGING_CONTAINER_PLATFORM:-$(node "$SCRIPT_DIR/deploy-targets.mjs" get staging containerPlatform)}"

# Validate required env vars
if [ -z "${STAGING_SSH_KEY:-}" ]; then
    log_error "STAGING_SSH_KEY not set"
    echo ""
    echo "Set it in .env.local or export:"
    echo "  export STAGING_SSH_KEY=~/.ssh/classroompath_staging"
    exit 1
fi

if [ -z "$STAGING_HOST" ]; then
    log_error "STAGING_HOST not set"
    echo ""
    echo "Set it in .env.local for private deployment only."
    exit 1
fi

if [ -z "$STAGING_USER" ]; then
    log_error "STAGING_USER not set"
    echo ""
    echo "Set it in .env.local for private deployment only."
    exit 1
fi

# Expand ~ in path
STAGING_SSH_KEY="$(expand_tilde "$STAGING_SSH_KEY")"

if [ ! -f "$STAGING_SSH_KEY" ]; then
    log_error "SSH key not found: $STAGING_SSH_KEY"
    exit 1
fi

case "$STAGING_IMAGE_MODE" in
    release-candidate)
        ;;
    source-build)
        log_error "npm run deploy:staging does not support source-build staging deploys"
        log_error "Allowed value: release-candidate"
        exit 2
        ;;
    *)
        log_error "Invalid STAGING_IMAGE_MODE: $STAGING_IMAGE_MODE"
        log_error "Allowed value: release-candidate"
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

if [ -n "${STAGING_RELEASE_MANIFEST_FILE:-}" ]; then
    if [ -z "${STAGING_GHCR_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
        STAGING_GHCR_USERNAME="${STAGING_GHCR_USERNAME:-balejosg}"
        STAGING_GHCR_TOKEN="$(gh auth token 2>/dev/null || true)"
        export STAGING_GHCR_USERNAME STAGING_GHCR_TOKEN
    fi
    if ! node "$SCRIPT_DIR/ghcr-preflight.mjs" staging --manifest-file "$STAGING_RELEASE_MANIFEST_FILE"; then
        echo ""
        echo "Set for this command only:"
        echo 'STAGING_GHCR_USERNAME=balejosg STAGING_GHCR_TOKEN="$(gh auth token)" npm run deploy:staging'
        exit 1
    fi
fi

mark_staging_release_fence_staged

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

invalidate_staging_verification_evidence_for_release
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
