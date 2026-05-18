#!/usr/bin/env bash
# doctor.sh - Quick prerequisite checks for deploy + migrations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/deploy-host-preflight.sh
source "$SCRIPT_DIR/lib/deploy-host-preflight.sh"

log_info "Running ClassroomPath doctor..."

require_cmd git
require_cmd npm
require_cmd docker
require_cmd ssh
require_cmd curl

if ! docker info >/dev/null 2>&1; then
  die "Docker daemon not reachable (is Docker running?)" 1
fi

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
else
  log_warn "Missing .env.local (copy from .env.local.example for staging deploy)"
fi

# Mirror deploy-staging-local.sh defaults
STAGING_HOST="${STAGING_HOST:-staging-host.example.invalid}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"
STAGING_IMAGE_MODE="${STAGING_IMAGE_MODE:-release-candidate}"
STAGING_DEPLOYMENT_MODE="${STAGING_DEPLOYMENT_MODE:-}"

case "$STAGING_IMAGE_MODE" in
  release-candidate|source-build)
    ;;
  *)
    die "Invalid STAGING_IMAGE_MODE=$STAGING_IMAGE_MODE (allowed: release-candidate, source-build)" 1
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
    die "Invalid STAGING_DEPLOYMENT_MODE=$STAGING_DEPLOYMENT_MODE (allowed: promotion-eligible, debug)" 1
    ;;
esac

if [ "$STAGING_DEPLOYMENT_MODE" = "promotion-eligible" ] && [ "$STAGING_IMAGE_MODE" != "release-candidate" ]; then
  die "STAGING_DEPLOYMENT_MODE=promotion-eligible requires STAGING_IMAGE_MODE=release-candidate" 1
fi

if [ -z "${STAGING_SSH_KEY:-}" ]; then
  die "STAGING_SSH_KEY not set (set it in .env.local or export it)" 1
fi

if [ -n "${STAGING_GHCR_TOKEN:-}" ] && [ -z "${STAGING_GHCR_USERNAME:-}" ]; then
  die "STAGING_GHCR_USERNAME must be set when STAGING_GHCR_TOKEN is provided" 1
fi

if [ "$STAGING_DEPLOYMENT_MODE" = "debug" ]; then
  log_warn "STAGING_DEPLOYMENT_MODE=debug is a debug/recovery mode and should not be used for normal promotion checks"
fi

STAGING_SSH_KEY="$(expand_tilde "$STAGING_SSH_KEY")"
if [ ! -f "$STAGING_SSH_KEY" ]; then
  die "SSH key not found: $STAGING_SSH_KEY" 1
fi

cd "$PROJECT_ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  log_warn "Uncommitted changes detected (staging deploy uses origin/main)"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git fetch origin main --quiet || true
  LOCAL_SHA=$(git rev-parse HEAD)
  REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "")
  if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    log_warn "Local HEAD differs from origin/main"
    log_info "Local:  $LOCAL_SHA"
    log_info "Remote: $REMOTE_SHA"
  fi
else
  log_warn "No 'origin' remote configured"
fi

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

log_info "Checking SSH connectivity to $STAGING_HOST..."
if ! "${SSH_CMD[@]}" "echo ok" >/dev/null 2>&1; then
  die "Cannot connect to staging host (check STAGING_* settings and network)" 1
fi
log_success "SSH connectivity OK"

log_info "Checking remote docker + app directory..."
REMOTE_OK=$("${SSH_CMD[@]}" "test -d /srv/classroompath/app && docker info >/dev/null 2>&1 && echo ok" 2>/dev/null || echo "")
if [ "$REMOTE_OK" != "ok" ]; then
  die "Remote prerequisites failed (missing /srv/classroompath/app or docker not running)" 1
fi
log_success "Remote prerequisites OK"

REMOTE_DISK_USAGE=$("${SSH_CMD[@]}" "df / | awk 'NR == 2 { gsub(/%/, \"\", \$5); print \$5 }'" 2>/dev/null || echo "")
if [ -n "$REMOTE_DISK_USAGE" ]; then
  log_info "Remote disk usage: ${REMOTE_DISK_USAGE}%"
  if disk_usage_exceeds_threshold "$REMOTE_DISK_USAGE"; then
    log_warn "Remote disk usage is above ${DEPLOY_DISK_THRESHOLD_PERCENT}% and may block deploys"
  fi
else
  log_warn "Unable to determine remote disk usage"
fi

log_success "Doctor checks passed"
