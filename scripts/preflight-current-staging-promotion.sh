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
STAGING_ONLY=0
EXPECTED_RC_RUN_ID="${EXPECTED_RC_RUN_ID:-}"
EXPECTED_CANDIDATE_SHA="${EXPECTED_CANDIDATE_SHA:-}"
EXPECTED_RELEASE_ID="${EXPECTED_RELEASE_ID:-}"
EXPECTED_OPENPATH_SHA="${EXPECTED_OPENPATH_SHA:-}"
EXPECTED_CONTRACT_SHA256="${EXPECTED_CONTRACT_SHA256:-}"
STAGING_CURRENT_OUTPUT="${STAGING_CURRENT_OUTPUT:-}"
STAGING_VERIFICATION_OUTPUT="${STAGING_VERIFICATION_OUTPUT:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --staging-only)
      STAGING_ONLY=1
      shift
      ;;
    --rc-run-id)
      [ "$#" -ge 2 ] || die "--rc-run-id requires a value" 2
      EXPECTED_RC_RUN_ID="$2"
      shift 2
      ;;
    --candidate-sha)
      [ "$#" -ge 2 ] || die "--candidate-sha requires a value" 2
      EXPECTED_CANDIDATE_SHA="$2"
      shift 2
      ;;
    --release-id)
      [ "$#" -ge 2 ] || die "--release-id requires a value" 2
      EXPECTED_RELEASE_ID="$2"
      shift 2
      ;;
    --openpath-sha)
      [ "$#" -ge 2 ] || die "--openpath-sha requires a value" 2
      EXPECTED_OPENPATH_SHA="$2"
      shift 2
      ;;
    --contract-sha256)
      [ "$#" -ge 2 ] || die "--contract-sha256 requires a value" 2
      EXPECTED_CONTRACT_SHA256="$2"
      shift 2
      ;;
    --current-output)
      [ "$#" -ge 2 ] || die "--current-output requires a value" 2
      STAGING_CURRENT_OUTPUT="$2"
      shift 2
      ;;
    --verification-output)
      [ "$#" -ge 2 ] || die "--verification-output requires a value" 2
      STAGING_VERIFICATION_OUTPUT="$2"
      shift 2
      ;;
    -h|--help)
      printf 'Usage: bash scripts/preflight-current-staging-promotion.sh [--staging-only] [--rc-run-id ID] [--candidate-sha SHA] [--release-id ID] [--openpath-sha SHA] [--contract-sha256 SHA] [--current-output FILE] [--verification-output FILE]\n'
      exit 0
      ;;
    *)
      die "Unsupported option: $1" 2
      ;;
  esac
done

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
if [ "$STAGING_ONLY" != "1" ]; then
  require_file DEPLOY_SSH_KEY
else
  DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"
fi

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

PRODUCTION_SSH_CMD=()
if [ "$STAGING_ONLY" != "1" ]; then
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
fi

log_info "Running current staging promotion preflight..."

"${STAGING_SSH_CMD[@]}" "cat /srv/classroompath/release-state/current-images.env" > "$current_state_file"
"${STAGING_SSH_CMD[@]}" "cat /srv/classroompath/release-state/staging-verification.env" > "$verification_state_file"
if [ "$STAGING_ONLY" != "1" ]; then
  "${PRODUCTION_SSH_CMD[@]}" "true" >/dev/null
fi

target_sha="$(read_env_value "$current_state_file" APP_SHA)"
current_image_source="$(read_env_value "$current_state_file" IMAGE_SOURCE)"
verified_sha="$(read_env_value "$verification_state_file" STAGING_VERIFIED_APP_SHA)"
verification_state="$(read_env_value "$verification_state_file" STAGING_VERIFICATION_STATE)"
verified_image_source="$(read_env_value "$verification_state_file" STAGING_VERIFIED_IMAGE_SOURCE)"
current_release_id="$(read_env_value "$current_state_file" RELEASE_ID)"
current_rc_run_id="$(read_env_value "$current_state_file" RC_RUN_ID)"
current_openpath_sha="$(read_env_value "$current_state_file" OPENPATH_SHA)"
current_contract_sha256="$(read_env_value "$current_state_file" OPENPATH_CONTRACT_SHA256)"
verified_release_id="$(read_env_value "$verification_state_file" STAGING_VERIFIED_RELEASE_ID)"
verified_rc_run_id="$(read_env_value "$verification_state_file" STAGING_VERIFIED_RC_RUN_ID)"
verified_openpath_sha="$(read_env_value "$verification_state_file" STAGING_VERIFIED_OPENPATH_SHA)"
verified_contract_sha256="$(read_env_value "$verification_state_file" STAGING_VERIFIED_OPENPATH_CONTRACT_SHA256)"

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

if [ -n "$EXPECTED_CANDIDATE_SHA" ] && [ "$target_sha" != "$EXPECTED_CANDIDATE_SHA" ]; then
  die "Preflight failed: staging candidate SHA does not match the explicit RC identity" 1
fi
if [ -n "$EXPECTED_RC_RUN_ID" ] &&
  { [ "$current_rc_run_id" != "$EXPECTED_RC_RUN_ID" ] || [ "$verified_rc_run_id" != "$EXPECTED_RC_RUN_ID" ]; }; then
  die "Preflight failed: staging RC run id does not match the explicit RC identity" 1
fi
if [ -n "$EXPECTED_RELEASE_ID" ] &&
  { [ "$current_release_id" != "$EXPECTED_RELEASE_ID" ] || [ "$verified_release_id" != "$EXPECTED_RELEASE_ID" ]; }; then
  die "Preflight failed: staging release id does not match the exact Release Bundle" 1
fi
if [ -n "$EXPECTED_OPENPATH_SHA" ] &&
  { [ "$current_openpath_sha" != "$EXPECTED_OPENPATH_SHA" ] || [ "$verified_openpath_sha" != "$EXPECTED_OPENPATH_SHA" ]; }; then
  die "Preflight failed: staging OpenPath SHA does not match the exact Release Bundle" 1
fi
if [ -n "$EXPECTED_CONTRACT_SHA256" ] &&
  { [ "$current_contract_sha256" != "$EXPECTED_CONTRACT_SHA256" ] || [ "$verified_contract_sha256" != "$EXPECTED_CONTRACT_SHA256" ]; }; then
  die "Preflight failed: staging OpenPath contract hash does not match the exact Release Bundle" 1
fi

if [ -n "$STAGING_CURRENT_OUTPUT" ]; then
  mkdir -p "$(dirname "$STAGING_CURRENT_OUTPUT")"
  install -m 600 "$current_state_file" "$STAGING_CURRENT_OUTPUT"
fi
if [ -n "$STAGING_VERIFICATION_OUTPUT" ]; then
  mkdir -p "$(dirname "$STAGING_VERIFICATION_OUTPUT")"
  install -m 600 "$verification_state_file" "$STAGING_VERIFICATION_OUTPUT"
fi

log_success "Current staging promotion preflight passed for $target_sha"
