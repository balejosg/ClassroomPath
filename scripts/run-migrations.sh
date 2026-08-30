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
  bash "$PROJECT_ROOT/scripts/run-migrations-docker.sh" --cp "$@"
  exit 0
fi

log_warn "Docker not available; falling back to npm on host"

require_cmd npm

if [ -f "$PROJECT_ROOT/config/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$PROJECT_ROOT/config/.env" | xargs)
fi

# The DB retirement confirmation is an invocation-scoped capability. A value
# persisted in config/.env or inherited from the host must never authorize a
# future ordinary migration run.
unset CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED

if [ -z "${DATABASE_URL:-}" ]; then
  die "DATABASE_URL environment variable is not set" 1
fi

cd "$PROJECT_ROOT"

MIGRATION_CLI_ARGS=()
for migration_arg in "$@"; do
  case "$migration_arg" in
    --confirm-windows-offline-installer-legacy-retirement)
      MIGRATION_CLI_ARGS+=("$migration_arg")
      ;;
    *)
      die "Unknown migration argument: $migration_arg" 2
      ;;
  esac
done

if [ ! -d "node_modules" ]; then
  log_info "Installing dependencies..."
  npm ci -w @classroompath/api
fi

log_info "Cleaning ClassroomPath schema drift..."
node --import tsx api/scripts/cleanup-cp-schema.ts

log_info "Reconciling ClassroomPath migration ledger..."
node --import tsx api/scripts/baseline-cp-migrations.ts

log_info "Running versioned migrations..."
if [ "${#MIGRATION_CLI_ARGS[@]}" -gt 0 ]; then
  npm run db:migrate -w @classroompath/api -- "${MIGRATION_CLI_ARGS[@]}"
else
  npm run db:migrate -w @classroompath/api
fi

log_success "Migrations completed successfully."
