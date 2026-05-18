#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd ssh
require_cmd node

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
fi

STAGING_HOST="${STAGING_HOST:-staging-host.example.invalid}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_CONFIG="${STAGING_SSH_CONFIG:-/dev/null}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"

resolve_default_deploy_host() {
  local public_url
  public_url="$(node "$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl)"
  public_url="${public_url#http://}"
  public_url="${public_url#https://}"
  printf '%s\n' "${public_url%%/*}"
}

DEPLOY_HOST="${DEPLOY_HOST:-$(resolve_default_deploy_host)}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"
DEPLOY_SSH_STRICT_HOSTKEY="${DEPLOY_SSH_STRICT_HOSTKEY:-accept-new}"

require_file() {
  local variable_name="$1"
  local path="${!variable_name:-}"

  if [ -z "$path" ]; then
    die "$variable_name must be set before current staging promotion" 1
  fi

  path="$(expand_tilde "$path")"
  if [ ! -f "$path" ]; then
    die "$variable_name file not found: $path" 1
  fi

  printf -v "$variable_name" '%s' "$path"
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { print $2 }' "$file" | tail -1
}

require_file STAGING_SSH_KEY
require_file DEPLOY_SSH_KEY

current_state_file="$(mktemp)"
verification_state_file="$(mktemp)"

cleanup() {
  rm -f "$current_state_file" "$verification_state_file"
}
trap cleanup EXIT

STAGING_SSH_CMD=(
  ssh
  -F "$STAGING_SSH_CONFIG"
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=${STAGING_SSH_STRICT_HOSTKEY}"
  -i "$STAGING_SSH_KEY"
  -p "$STAGING_PORT"
  "${STAGING_USER}@${STAGING_HOST}"
)

PRODUCTION_SSH_CMD=(
  ssh
  -F "$DEPLOY_SSH_CONFIG"
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=${DEPLOY_SSH_STRICT_HOSTKEY}"
  -i "$DEPLOY_SSH_KEY"
  -p "$DEPLOY_PORT"
  "${DEPLOY_USER}@${DEPLOY_HOST}"
)

log_info "Running current staging promotion preflight..."

"${STAGING_SSH_CMD[@]}" "cat /srv/classroompath/release-state/current-images.env" > "$current_state_file"
"${STAGING_SSH_CMD[@]}" "cat /srv/classroompath/release-state/staging-verification.env" > "$verification_state_file"
"${PRODUCTION_SSH_CMD[@]}" "true" >/dev/null

target_sha="$(read_env_value "$current_state_file" APP_SHA)"
current_image_source="$(read_env_value "$current_state_file" IMAGE_SOURCE)"
verified_sha="$(read_env_value "$verification_state_file" STAGING_VERIFIED_APP_SHA)"
verification_state="$(read_env_value "$verification_state_file" STAGING_VERIFICATION_STATE)"
verified_image_source="$(read_env_value "$verification_state_file" STAGING_VERIFIED_IMAGE_SOURCE)"

if [ -z "$target_sha" ]; then
  die "Preflight failed: staging current-images.env does not include APP_SHA" 1
fi

if [ "$target_sha" != "$verified_sha" ]; then
  die "Preflight failed: staging APP_SHA $target_sha does not match verified SHA ${verified_sha:-unset}" 1
fi

if [ "$verification_state" != "success" ]; then
  die "Preflight failed: STAGING_VERIFICATION_STATE=${verification_state:-unset}; expected success" 1
fi

if [ "$current_image_source" != "release-candidate" ]; then
  die "Preflight failed: IMAGE_SOURCE=${current_image_source:-unset}; expected release-candidate" 1
fi

if [ "$verified_image_source" != "release-candidate" ]; then
  die "Preflight failed: STAGING_VERIFIED_IMAGE_SOURCE=${verified_image_source:-unset}; expected release-candidate" 1
fi

log_success "Current staging promotion preflight passed for $target_sha"
