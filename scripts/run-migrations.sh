#!/usr/bin/env bash
# ClassroomPath Gateway Database Migrations
#
# Preferred path: run schema pushes using Docker so the host doesn't need Node.
# Fallback path: run via npm workspaces when docker isn't available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

log_info "Running ClassroomPath Gateway database migrations..."
log_info "Project root: $PROJECT_ROOT"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  bash "$PROJECT_ROOT/scripts/run-migrations-docker.sh" --cp
  exit 0
fi

log_warn "Docker not available; falling back to npm on host"

require_cmd npm

if [ -f "$PROJECT_ROOT/config/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$PROJECT_ROOT/config/.env" | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  die "DATABASE_URL environment variable is not set" 1
fi

cd "$PROJECT_ROOT"
if [ ! -d "node_modules" ]; then
  log_info "Installing dependencies..."
  npm ci -w @classroompath/api
fi

log_info "Running drizzle-kit push..."
npm run db:push -w @classroompath/api

log_success "Migrations completed successfully."
