#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.test.yml"

# Avoid collisions with other compose projects on the same machine.
# You can override this by exporting COMPOSE_PROJECT_NAME.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-classroompath_test}"

docker_compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

# Cleanup: stop container but preserve volume for faster subsequent runs.
# Use 'npm run db:test:reset' to fully destroy and recreate.
cleanup() {
  if [ -f "$COMPOSE_FILE" ]; then
    docker_compose stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_cmd docker
require_cmd npm

# Require Playwright browsers to be installed.
PW_CACHE_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ ! -d "$PW_CACHE_DIR" ] || ! ls "$PW_CACHE_DIR"/chromium-* >/dev/null 2>&1; then
  echo "Playwright browsers are not installed." >&2
  echo "Run: npx playwright install --with-deps chromium" >&2
  exit 1
fi

# Ensure Docker daemon is running.
docker info >/dev/null 2>&1 || {
  echo "Docker is not running (docker info failed). Start Docker and retry." >&2
  exit 1
}

cd "$ROOT_DIR"

echo "Starting PostgreSQL (test)"
docker_compose up -d postgres

echo "Waiting for PostgreSQL to be healthy"
for i in {1..30}; do
  status=$(docker inspect --format='{{json .State.Health.Status}}' "$(docker_compose ps -q postgres)" 2>/dev/null || true)
  if [ "$status" = '"healthy"' ]; then
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "PostgreSQL did not become healthy in time" >&2
    docker_compose logs postgres || true
    exit 1
  fi
done

export DATABASE_URL="postgres://openpath:openpath_dev@localhost:5433/openpath"
export DB_HOST="localhost"
export DB_PORT="5433"
export DB_NAME="openpath"
export DB_USER="openpath"
export DB_PASSWORD="openpath_dev"
export JWT_SECRET="test-jwt-secret"

# Keep Playwright behavior consistent with CI.
export CI=true

echo "Running typecheck"
# OpenPath React SPA's tRPC client types come from @openpath/api's emitted d.ts (api/dist).
# Ensure shared + api are built so AppRouter reflects the current routers.
(cd upstream/openpath && npm run build --workspace=@openpath/shared --workspace=@openpath/api)

npm run typecheck

echo "Running lint"
npm run lint

echo "Running format check"
npm run format:check

echo "Running build (CI parity)"
npm run build

echo "Running bundle size check"
npm run size:check

echo "Running unit tests (SPA)"
npm run test --workspace=@classroompath/react-spa

echo "Running migrations"
npm run db:push --workspace=@classroompath/api
npm run db:push --workspace=@openpath/api

echo "Running unit tests (API)"
npm run test --workspace=@classroompath/api

echo "Running API integration tests"
npm run test:integration --workspace=@classroompath/api

echo "Seeding E2E database"
npm run db:seed:e2e --workspace=@classroompath/api

echo "Running Playwright E2E tests"
# Stop any Docker containers that might occupy Playwright's ports (3001, 3010, 5173).
# The openpath-api container maps 3001 externally and conflicts with ClassroomPath gateway.
docker stop openpath-api 2>/dev/null || true
# Kill any orphaned node processes from previous timed-out runs.
for port in 3001 3010 5173; do
  pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K\d+' | head -1 || true)
  if [ -n "$pid" ]; then
    echo "Killing orphaned process on port $port (PID: $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done
# Playwright config starts the web server(s) as needed.
npx playwright test

echo "Running npm audit (high)"
npm run security:audit

echo "Running secretlint"
npm run security:secrets

echo "All checks passed"
