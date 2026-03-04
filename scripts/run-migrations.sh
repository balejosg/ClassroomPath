#!/usr/bin/env bash
# ClassroomPath Gateway Database Migrations
#
# Preferred path: run schema pushes using Docker so the host doesn't need Node.
# Fallback path: run via npm workspaces when docker isn't available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Running ClassroomPath Gateway database migrations..."
echo "  Project root: $PROJECT_ROOT"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  bash "$PROJECT_ROOT/scripts/run-migrations-docker.sh" --cp
  exit 0
fi

echo "[WARN] Docker not available; falling back to npm on host"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm command not found" >&2
  exit 1
fi

if [ -f "$PROJECT_ROOT/config/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$PROJECT_ROOT/config/.env" | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is not set" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm ci -w @classroompath/api
fi

echo "Running drizzle-kit push..."
npm run db:push -w @classroompath/api

echo "Migrations completed successfully."
