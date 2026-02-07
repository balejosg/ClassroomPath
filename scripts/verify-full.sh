#!/usr/bin/env bash
# verify-full.sh - Complete verification before commit
#
# Optimized for speed with parallelization where safe.
# Structure:
#   [1/5] Build (sequential - required for types)
#   [2/5] Static Analysis (parallel: typecheck, lint, format)
#   [3/5] Security & Size (parallel: audit, secrets, size)
#   [4/5] Unit & Integration Tests (DB-dependent)
#   [5/5] E2E Playwright Tests
#
# Expected time: ~115s (down from ~160s)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.test.yml"

# Avoid collisions with other compose projects on the same machine.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-classroompath_test}"

# Track parallel job failures
PARALLEL_FAILED=0

docker_compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

# Run commands in parallel and fail if any fails
run_parallel() {
  local pids=()
  local cmds=("$@")
  
  for cmd in "${cmds[@]}"; do
    eval "$cmd" &
    pids+=($!)
  done
  
  local failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  
  return $failed
}

# Cleanup: stop container but preserve volume for faster subsequent runs.
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

echo ""
echo "=========================================="
echo "  ClassroomPath Verification Starting"
echo "=========================================="
echo ""

# Pre-check: Verify test files exist (fast, ~0.1s)
echo "[0/5] Checking test file coverage..."
bash scripts/check-test-files.sh

# Start PostgreSQL early (runs in background while we build)
echo "Starting PostgreSQL (test)..."
docker_compose up -d postgres

# =============================================================================
# [1/5] BUILD - Sequential (required for typecheck)
# =============================================================================
echo ""
echo "[1/5] Building all packages..."

# Single build pass - no duplication
npm run build

# Wait for PostgreSQL to be healthy (should be ready by now)
echo "Waiting for PostgreSQL..."
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
export CI=true

# =============================================================================
# [2/5] STATIC ANALYSIS - Parallel (typecheck, lint, format)
# =============================================================================
echo ""
echo "[2/5] Static analysis (parallel: typecheck, lint, format)..."

run_parallel \
  "npm run typecheck" \
  "npm run lint" \
  "npm run format:check" \
|| {
  echo "Static analysis failed!" >&2
  exit 1
}

# =============================================================================
# [3/5] SECURITY & SIZE - Parallel
# =============================================================================
echo ""
echo "[3/5] Security and size checks (parallel)..."

run_parallel \
  "npm run security:audit" \
  "npm run security:secrets" \
  "npm run size:check" \
|| {
  echo "Security/size checks failed!" >&2
  exit 1
}

# =============================================================================
# [4/5] UNIT & INTEGRATION TESTS
# =============================================================================
echo ""
echo "[4/5] Running tests..."

# Run migrations (parallel for both schemas)
echo "Running migrations..."
npm run db:push --workspace=@classroompath/api --workspace=@openpath/api

# SPA tests don't need DB, can run in parallel with API tests setup
echo "Running unit tests (SPA)..."
npm run test --workspace=@classroompath/react-spa &
SPA_PID=$!

echo "Running unit tests (API)..."
npm run test --workspace=@classroompath/api

# Wait for SPA tests
if ! wait $SPA_PID; then
  echo "SPA unit tests failed!" >&2
  exit 1
fi

echo "Running API integration tests..."
npm run test:integration --workspace=@classroompath/api

# =============================================================================
# [5/5] E2E PLAYWRIGHT TESTS
# =============================================================================
echo ""
echo "[5/5] E2E Playwright tests..."

# Stop any Docker containers that might occupy Playwright's ports (3001, 3010, 5173).
docker stop openpath-api 2>/dev/null || true

# Kill any orphaned node processes from previous timed-out runs.
for port in 3001 3010 5173; do
  pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K\d+' | head -1 || true)
  if [ -n "$pid" ]; then
    echo "Killing orphaned process on port $port (PID: $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

# Playwright global-setup handles seeding, no need to seed here
npx playwright test

# =============================================================================
# FINAL: Coverage check on changed files
# =============================================================================
echo ""
echo "[Final] Checking coverage on changed files..."
node scripts/check-new-file-coverage.js

echo ""
echo "=========================================="
echo "  All Checks Passed!"
echo "=========================================="
echo ""
