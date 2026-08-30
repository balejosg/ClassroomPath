#!/usr/bin/env bash
# run-migrations-docker.sh - Run DB schema migrations using Docker
#
# Why this exists:
# - Prefer prebuilt migration runner images for staging/prod promotion
# - Fall back to workspace-root npm installs when a runner image is unavailable
# - Avoid requiring Node/npm on the host
# - Keep staging/prod migrations consistent with deploy scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR_DEFAULT="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENPATH_DB_ENV_HELPER_PATH="$SCRIPT_DIR/derive-openpath-db-env.mjs"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/deploy-images.sh
source "$SCRIPT_DIR/lib/deploy-images.sh"

# Pinned to the digest of node:20-alpine at time of writing.
# Override if you need to roll forward/back quickly:
#   MIGRATIONS_NODE_IMAGE=node:20-alpine bash scripts/run-migrations-docker.sh --cp
MIGRATIONS_NODE_IMAGE_DEFAULT="node@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8"
MIGRATIONS_NODE_IMAGE_FALLBACK="node:20-alpine"

usage() {
  cat <<'EOF'
Usage:
  scripts/run-migrations-docker.sh [--cp] [--openpath] [--app-dir <dir>] [--env-file <path>] [--node-image <image>] [--runner-image <image>] [--confirm-windows-offline-installer-legacy-retirement]

Options:
  --cp                 Run ClassroomPath gateway API migrations (@classroompath/api)
  --openpath           Run OpenPath core API migrations (@openpath/api)
  --app-dir <dir>      Root directory (default: repo root)
  --env-file <path>    Env file to pass to containers (default: <app-dir>/config/.env)
  --node-image <img>   Node image to use (default: pinned digest)
  --runner-image <img> Prebuilt migration runner image to use instead of npm-installing in a generic Node image
  --confirm-windows-offline-installer-legacy-retirement
                       Apply the deferred destructive legacy-ref retirement migration once the drain is proven

Notes:
  - If no schema flags are provided, both --cp and --openpath are run.
  - Without --runner-image, this script installs dependencies via npm workspaces at the workspace root.
EOF
}

APP_DIR="$APP_DIR_DEFAULT"
RUN_CP=0
RUN_OPENPATH=0
ENV_FILE=""
NODE_IMAGE="${MIGRATIONS_NODE_IMAGE:-$MIGRATIONS_NODE_IMAGE_DEFAULT}"
RUNNER_IMAGE=""
CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT=0

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
    --runner-image)
      RUNNER_IMAGE="$2"
      shift 2
      ;;
    --confirm-windows-offline-installer-legacy-retirement)
      CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT=1
      shift
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

if [ "$CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT" = "1" ] && [ "$RUN_CP" = "0" ]; then
  die "The Windows offline installer legacy retirement confirmation requires --cp" 1
fi

if [ -z "$ENV_FILE" ]; then
  ENV_FILE="$APP_DIR/config/.env"
fi

require_cmd docker

if [ ! -f "$OPENPATH_DB_ENV_HELPER_PATH" ]; then
  die "OpenPath DB env helper not found: $OPENPATH_DB_ENV_HELPER_PATH" 1
fi

if [ ! -d "$APP_DIR" ]; then
  die "App dir not found: $APP_DIR" 1
fi

if [ ! -f "$ENV_FILE" ]; then
  die "Env file not found: $ENV_FILE" 1
fi

# Docker env files are allowed to contain stale operator state. Always pass a
# neutral value; the migration entrypoint receives authorization only through
# its invocation-scoped CLI argument.
migration_confirmation_env_args=(-e "CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED=0")

run_prebuilt_runner_image() {
  log_info "[MIGRATIONS] Using prebuilt migration runner image: $RUNNER_IMAGE"

  local args=()
  if [ "$RUN_CP" = "1" ]; then
    args+=("--cp")
  fi
  if [ "$RUN_OPENPATH" = "1" ]; then
    args+=("--openpath")
  fi
  if [ "$CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT" = "1" ]; then
    args+=("--confirm-windows-offline-installer-legacy-retirement")
  fi

  docker_prepare_required_image "$RUNNER_IMAGE" "migration runner image" || return 1

  docker run --rm \
    --add-host host.docker.internal:host-gateway \
    --env-file "$ENV_FILE" \
    "${migration_confirmation_env_args[@]}" \
    "$RUNNER_IMAGE" \
    "${args[@]}"
}

if [ -n "$RUNNER_IMAGE" ]; then
  run_prebuilt_runner_image
  exit 0
fi

docker_select_image_with_fallback \
  NODE_IMAGE \
  "$NODE_IMAGE" \
  "$MIGRATIONS_NODE_IMAGE_FALLBACK" \
  "node image" || exit 1

run_cp_migrations() {
  log_info "[MIGRATIONS] - ClassroomPath API schema..."
  local log
  log=$(mktemp)

  local migration_command='npm run db:migrate -w @classroompath/api'
  if [ "$CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT" = "1" ]; then
    migration_command+=' -- --confirm-windows-offline-installer-legacy-retirement'
  fi

  if docker run --rm \
    -v "$APP_DIR:/app" \
    -v "$ENV_FILE:/app/.env:ro" \
    -w /app \
    --env-file "$ENV_FILE" \
    "${migration_confirmation_env_args[@]}" \
    "$NODE_IMAGE" \
    sh -c "npm ci --silent -w @classroompath/api && node --import tsx api/scripts/cleanup-cp-schema.ts && node --import tsx api/scripts/baseline-cp-migrations.ts && $migration_command" \
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
    -v "$OPENPATH_DB_ENV_HELPER_PATH:/derive-openpath-db-env.mjs:ro" \
    -w /app \
    --env-file "$ENV_FILE" \
    "${migration_confirmation_env_args[@]}" \
    "$NODE_IMAGE" \
    sh -c "eval \"\$(node /derive-openpath-db-env.mjs)\" && npm ci --silent && npm run db:migrate -w @openpath/api" \
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
