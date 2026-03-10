#!/usr/bin/env bash
# run-migrations-docker.sh - Run DB schema pushes using Docker + npm workspaces
#
# Why this exists:
# - Avoid per-package lockfile drift (install from workspace root)
# - Avoid requiring Node/npm on the host
# - Keep staging/prod migrations consistent with deploy scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR_DEFAULT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

# Pinned to the digest of node:20-alpine at time of writing.
# Override if you need to roll forward/back quickly:
#   MIGRATIONS_NODE_IMAGE=node:20-alpine bash scripts/run-migrations-docker.sh --cp
MIGRATIONS_NODE_IMAGE_DEFAULT="node@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8"
MIGRATIONS_NODE_IMAGE_FALLBACK="node:20-alpine"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-migrations-docker.sh [--cp] [--openpath] [--app-dir <dir>] [--env-file <path>] [--node-image <image>]

Options:
  --cp                 Run ClassroomPath gateway API schema push (@classroompath/api)
  --openpath           Run OpenPath core API schema push (@openpath/api)
  --app-dir <dir>      Root directory (default: repo root)
  --env-file <path>    Env file to pass to containers (default: <app-dir>/config/.env)
  --node-image <img>   Node image to use (default: pinned digest)

Notes:
  - If no schema flags are provided, both --cp and --openpath are run.
  - This script installs dependencies via npm workspaces at the workspace root.
EOF
}

APP_DIR="$APP_DIR_DEFAULT"
RUN_CP=0
RUN_OPENPATH=0
ENV_FILE=""
NODE_IMAGE="${MIGRATIONS_NODE_IMAGE:-$MIGRATIONS_NODE_IMAGE_DEFAULT}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cp)
      RUN_CP=1
      shift
      ;;
    --openpath)
      RUN_OPENPATH=1
      shift
      ;;
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --node-image)
      NODE_IMAGE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$RUN_CP" = "0" ] && [ "$RUN_OPENPATH" = "0" ]; then
  RUN_CP=1
  RUN_OPENPATH=1
fi

if [ -z "$ENV_FILE" ]; then
  ENV_FILE="$APP_DIR/config/.env"
fi

require_cmd docker

if [ ! -d "$APP_DIR" ]; then
  die "App dir not found: $APP_DIR" 1
fi

if [ ! -f "$ENV_FILE" ]; then
  die "Env file not found: $ENV_FILE" 1
fi

ensure_node_image() {
  local img="$1"

  if docker image inspect "$img" >/dev/null 2>&1; then
    return 0
  fi

  docker pull "$img" >/dev/null 2>&1
}

if ! ensure_node_image "$NODE_IMAGE"; then
  log_warn "Unable to fetch node image: $NODE_IMAGE"
  log_warn "Falling back to: $MIGRATIONS_NODE_IMAGE_FALLBACK"
  NODE_IMAGE="$MIGRATIONS_NODE_IMAGE_FALLBACK"
  ensure_node_image "$NODE_IMAGE" || {
    log_error "Unable to fetch node image: $NODE_IMAGE"
    exit 1
  }
fi

run_cp_migrations() {
  log_info "[MIGRATIONS] - ClassroomPath API schema..."
  local log
  log=$(mktemp)

  if docker run --rm \
    -v "$APP_DIR:/app" \
    -v "$ENV_FILE:/app/.env:ro" \
    -w /app \
    --env-file "$ENV_FILE" \
    "$NODE_IMAGE" \
    sh -c "npm ci --silent -w @classroompath/api && node --import tsx api/scripts/ensure-legacy-cp-schema.ts && npm run db:push -w @classroompath/api" \
    >"$log" 2>&1; then
    tail -5 "$log"
  else
    cat "$log"
    rm -f "$log"
    return 1
  fi

  rm -f "$log"
}

run_openpath_migrations() {
  log_info "[MIGRATIONS] - OpenPath API schema..."
  local log
  log=$(mktemp)

  if docker run --rm \
    -v "$APP_DIR/upstream/openpath:/app" \
    -v "$ENV_FILE:/app/.env:ro" \
    -w /app \
    --env-file "$ENV_FILE" \
    "$NODE_IMAGE" \
    sh -c "npm ci --silent -w @openpath/shared -w @openpath/api && npm run db:push -w @openpath/api" \
    >"$log" 2>&1; then
    tail -5 "$log"
  else
    cat "$log"
    rm -f "$log"
    return 1
  fi

  rm -f "$log"
}

if [ "$RUN_CP" = "1" ]; then
  run_cp_migrations
fi

if [ "$RUN_OPENPATH" = "1" ]; then
  run_openpath_migrations
fi
