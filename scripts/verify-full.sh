#!/usr/bin/env bash
# verify-full.sh - Complete verification before commit
#
# Optimized for speed with parallelization where safe.
# Structure:
#   [1/5] Build (sequential - required for types)
#   [2/5] Static Analysis (parallel: typecheck, lint, format)
#   [3/5] Security & Size (parallel: audit, secrets, size)
#   [4/5] Unit & Integration Tests (DB-dependent)
#         Coverage is generated only when needed by the 80% gate
#         Coverage gate on changed files (fail fast before E2E)
#   [5/5] E2E Playwright Tests
#
# OPTIMIZATION: When only the submodule is updated, OpenPath static checks
# are skipped because they already passed in the OpenPath repo's pre-commit.
# This saves ~30-45s per submodule-only commit.
#
# Expected time: ~90s (submodule-only) / ~115s (full)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.test.yml"

pick_test_db_port() {
  node -e "const net = require('node:net'); const server = net.createServer(); server.listen(0, '127.0.0.1', () => { console.log(server.address().port); server.close(); });"
}

TEST_DB_PORT="${TEST_DB_PORT:-$(pick_test_db_port)}"
export TEST_DB_PORT

# Isolate the test compose stack per verification run unless the caller
# provided a custom project name on purpose. This avoids other local runs
# stopping the same postgres container mid-hook.
DEFAULT_COMPOSE_PROJECT_NAME="classroompath_test"
PROJECT_CKSUM="$(printf '%s' "$ROOT_DIR" | cksum | awk '{print $1}')"
if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ "$COMPOSE_PROJECT_NAME" != "$DEFAULT_COMPOSE_PROJECT_NAME" ]; then
  VERIFY_COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME"
else
  VERIFY_COMPOSE_PROJECT_NAME="${DEFAULT_COMPOSE_PROJECT_NAME}_${PROJECT_CKSUM}_$$"
fi
COMPOSE_PROJECT_NAME="$VERIFY_COMPOSE_PROJECT_NAME"
export COMPOSE_PROJECT_NAME

# Track parallel job failures
PARALLEL_FAILED=0

# =============================================================================
# OPTIMIZATION: Detect submodule-only changes
# =============================================================================
# If the only staged change is upstream/openpath, we can skip redundant checks
# because OpenPath's pre-commit already validated typecheck/lint/security.
SUBMODULE_ONLY=0
SKIP_OPENPATH_STATIC=0

# Only generate coverage when there are staged changes in src/ that the
# coverage gate evaluates (api/src/** and react-spa/src/**).
NEEDS_API_COVERAGE=0
NEEDS_SPA_COVERAGE=0

detect_change_type() {
  local staged_files
  staged_files=$(git diff --cached --name-only 2>/dev/null || echo "")
  
  if [ -z "$staged_files" ]; then
    # No staged files - running manually, do full verification
    return
  fi
  
  # Check if ALL staged files are just the submodule pointer
  local non_submodule_files
  non_submodule_files=$(echo "$staged_files" | grep -v "^upstream/openpath$" || true)
  
  if [ -z "$non_submodule_files" ]; then
    SUBMODULE_ONLY=1
    SKIP_OPENPATH_STATIC=1
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ⚡ OPTIMIZATION: Submodule-only update detected"
    echo "  → Skipping OpenPath static checks (already verified in OpenPath repo)"
    echo "  → Expected time savings: ~30-45s"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
  fi
}

detect_coverage_needs() {
  local staged_files
  staged_files=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || echo "")

  if [ -z "$staged_files" ]; then
    # No staged files - running manually, do full coverage for safety.
    NEEDS_API_COVERAGE=1
    NEEDS_SPA_COVERAGE=1
    return
  fi

  if echo "$staged_files" | grep -qE '^api/src/.*\.(ts|tsx)$'; then
    NEEDS_API_COVERAGE=1
  fi

  if echo "$staged_files" | grep -qE '^react-spa/src/.*\.(ts|tsx)$'; then
    NEEDS_SPA_COVERAGE=1
  fi

  if [ "$NEEDS_API_COVERAGE" = "0" ] && [ "$NEEDS_SPA_COVERAGE" = "0" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ⚡ OPTIMIZATION: No ClassroomPath src changes detected"
    echo "  → Running tests without coverage instrumentation"
    echo "  → Coverage gate will be skipped"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
  else
    echo "Coverage will be generated for:"
    if [ "$NEEDS_API_COVERAGE" = "1" ]; then
      echo "  - api"
    fi
    if [ "$NEEDS_SPA_COVERAGE" = "1" ]; then
      echo "  - react-spa"
    fi
    echo ""
  fi
}

docker_compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

wait_for_test_postgres() {
  for i in {1..30}; do
    if docker_compose exec -T postgres pg_isready -U openpath -d openpath >/dev/null 2>&1 \
      && TEST_DB_PORT="$TEST_DB_PORT" node -e "const net = require('node:net'); const socket = net.connect({ host: '127.0.0.1', port: Number(process.env.TEST_DB_PORT) }); socket.once('connect', () => { socket.end(); process.exit(0); }); socket.once('error', () => process.exit(1)); setTimeout(() => process.exit(1), 1000);" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  return 1
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

# Detect if this is a submodule-only update
detect_change_type
detect_coverage_needs

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
if ! wait_for_test_postgres; then
  echo "PostgreSQL did not become healthy in time" >&2
  docker_compose logs postgres || true
  exit 1
fi

export DATABASE_URL="postgres://openpath:openpath_dev@localhost:${TEST_DB_PORT}/openpath"
export DB_HOST="localhost"
export DB_PORT="$TEST_DB_PORT"
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

if [ "$SKIP_OPENPATH_STATIC" = "1" ]; then
  echo "  → Skipping OpenPath typecheck/lint (already verified upstream)"
  echo "  → Running ClassroomPath-only checks..."
  run_parallel \
    "npm run format:check" \
    "npm run lint --workspace=@classroompath/react-spa" \
  || {
    echo "Static analysis failed!" >&2
    exit 1
  }
else
  # Use Turbo's cache for OpenPath static analysis (much faster on repeat runs)
  echo "  → Using Turbo cache for OpenPath static analysis..."
  run_parallel \
    "cd upstream/openpath && npm run verify:static" \
    "npm run format:check" \
    "npm run lint --workspace=@classroompath/react-spa" \
  || {
    echo "Static analysis failed!" >&2
    exit 1
  }
fi

# =============================================================================
# [3/5] SECURITY & SIZE - Parallel
# =============================================================================
echo ""
echo "[3/5] Security and size checks (parallel)..."

if [ "$SKIP_OPENPATH_STATIC" = "1" ]; then
  echo "  → Skipping OpenPath security/size checks (already verified upstream)"
  echo "  → Running ClassroomPath-only audit..."
  # Only run npm audit for ClassroomPath's own dependencies
  npm audit --audit-level=high || {
    echo "Security audit failed!" >&2
    exit 1
  }
else
  run_parallel \
    "npm run security:audit" \
    "npm run security:secrets" \
    "npm run size:check" \
  || {
    echo "Security/size checks failed!" >&2
    exit 1
  }
fi

# =============================================================================
# [4/5] UNIT & INTEGRATION TESTS
# =============================================================================
echo ""
echo "[4/5] Running tests..."

# Run migrations (parallel for both schemas)
echo "Running migrations..."
npm run db:push --workspace=@classroompath/api --workspace=@openpath/api

# Ensure coverage artifacts reflect THIS run
rm -rf api/coverage api/.nyc_output react-spa/coverage react-spa/.nyc_output

# SPA tests don't need DB, can run in parallel with API tests setup
if [ "$NEEDS_SPA_COVERAGE" = "1" ]; then
  echo "Running unit tests (SPA, with coverage)..."
  npm run test:coverage --workspace=@classroompath/react-spa &
else
  echo "Running unit tests (SPA)..."
  npm run test --workspace=@classroompath/react-spa &
fi
SPA_PID=$!

if [ "$NEEDS_API_COVERAGE" = "1" ]; then
  echo "Running unit + integration tests (API, with coverage)..."
  npm run test:coverage --workspace=@classroompath/api
else
  echo "Running unit tests (API)..."
  npm run test --workspace=@classroompath/api
  echo "Running integration tests (API)..."
  npm run test:integration --workspace=@classroompath/api
fi

# Wait for SPA tests
if ! wait $SPA_PID; then
  echo "SPA unit tests failed!" >&2
  exit 1
fi

echo ""
echo "[4/5] Checking coverage on changed files (if any)..."
node scripts/check-new-file-coverage.js

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
# db:push already ran in [4/5], so skip duplicate push in global-setup.
# Exclude long-running opt-in suites by default:
# - @slow-network (network throttling)
# - @repro (debug/soak repro harnesses)
# Auto-tune worker count for local verify runs to reduce wall time.
# Override with PLAYWRIGHT_WORKERS=<n> when needed.
detect_playwright_workers() {
  if [ -n "${PLAYWRIGHT_WORKERS:-}" ]; then
    echo "$PLAYWRIGHT_WORKERS"
    return
  fi

  local cores
  cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)

  if [ "$cores" -ge 8 ]; then
    echo 4
  elif [ "$cores" -ge 4 ]; then
    echo 3
  else
    echo 2
  fi
}

PW_WORKERS=$(detect_playwright_workers)
echo "Using Playwright workers: $PW_WORKERS"

# Run with VERIFY_ALL=1 to include all tests
if [ "${VERIFY_ALL:-}" = "1" ]; then
  echo "Running ALL E2E tests (including @slow-network and @repro)..."
  E2E_SKIP_DB_PUSH=1 PLAYWRIGHT_WORKERS="$PW_WORKERS" npx playwright test
else
  echo "Running E2E tests (excluding @slow-network and @repro)..."
  E2E_SKIP_DB_PUSH=1 PLAYWRIGHT_WORKERS="$PW_WORKERS" npx playwright test --grep-invert="@slow-network|@repro"

  echo "Running mandatory navigation repro smoke..."
  E2E_SKIP_DB_PUSH=1 \
    PLAYWRIGHT_WORKERS=1 \
    NAV_REPRO_ROUNDS="${NAV_REPRO_ROUNDS:-3}" \
    NAV_REPRO_TIMEOUT_MS="${NAV_REPRO_TIMEOUT_MS:-120000}" \
    npx playwright test tests/e2e/navigation-noop-repro.spec.ts --project=chromium
fi

echo ""
echo "=========================================="
echo "  All Checks Passed!"
echo "=========================================="
echo ""
