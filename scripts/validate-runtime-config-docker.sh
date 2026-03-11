#!/usr/bin/env bash
# validate-runtime-config-docker.sh - Validate ClassroomPath runtime config using Docker
#
# Why this exists:
# - Avoid requiring Node/npm on the deployment host
# - Keep runtime validation aligned with the repo workspace toolchain

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR_DEFAULT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

VALIDATION_NODE_IMAGE_DEFAULT="node@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8"
VALIDATION_NODE_IMAGE_FALLBACK="node:20-alpine"

usage() {
  cat <<'EOF'
Usage:
  scripts/validate-runtime-config-docker.sh [--app-dir <dir>] [--env-file <path>] [--node-image <image>]

Options:
  --app-dir <dir>      Root directory (default: repo root)
  --env-file <path>    Env file to pass to the validation container (default: <app-dir>/config/.env)
  --node-image <img>   Node image to use (default: pinned digest)
EOF
}

APP_DIR="$APP_DIR_DEFAULT"
ENV_FILE=""
NODE_IMAGE="${VALIDATION_NODE_IMAGE:-$VALIDATION_NODE_IMAGE_DEFAULT}"

while [ "$#" -gt 0 ]; do
  case "$1" in
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
  log_warn "Falling back to: $VALIDATION_NODE_IMAGE_FALLBACK"
  NODE_IMAGE="$VALIDATION_NODE_IMAGE_FALLBACK"
  ensure_node_image "$NODE_IMAGE" || {
    log_error "Unable to fetch node image: $NODE_IMAGE"
    exit 1
  }
fi

log_info "[VALIDATION] - ClassroomPath runtime config..."

docker run --rm \
  -v "$APP_DIR:/app" \
  -w /app \
  --env-file "$ENV_FILE" \
  "$NODE_IMAGE" \
  sh -c "npm ci --silent -w @classroompath/api && node --import tsx api/scripts/validate-runtime-config.ts"
