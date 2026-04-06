#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/classroompath/app}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  SCRIPT_DIR="$APP_DIR/scripts"
fi

REMOTE_BOOTSTRAP_HELPER_PATH="$SCRIPT_DIR/lib/remote-bootstrap.sh"
if [ ! -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  REMOTE_BOOTSTRAP_HELPER_PATH="$APP_DIR/scripts/lib/remote-bootstrap.sh"
fi

if [ -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then
  # shellcheck source=lib/remote-bootstrap.sh
  source "$REMOTE_BOOTSTRAP_HELPER_PATH"
else
  resolve_remote_script_dir() {
    local app_dir="$1"
    local script_source="${2:-}"

    if [ -n "$script_source" ]; then
      cd "$(dirname "$script_source")" && pwd
      return 0
    fi

    printf '%s/scripts\n' "$app_dir"
  }

  resolve_remote_helper_path() {
    local script_dir="$1"
    local app_dir="$2"
    local relative_path="$3"
    local resolved_path="$script_dir/$relative_path"

    if [ ! -f "$resolved_path" ]; then
      resolved_path="$app_dir/scripts/$relative_path"
    fi

    printf '%s\n' "$resolved_path"
  }
fi

SCRIPT_DIR="$(resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE")"
COMMON_SH_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/common.sh")"
RELEASE_STATE_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-state.sh")"

# shellcheck source=lib/common.sh
source "$COMMON_SH_PATH"

if [ ! -f "$RELEASE_STATE_HELPER_PATH" ]; then
  load_release_state_env() {
    local state_path="$1"

    if [ ! -f "$state_path" ]; then
      log_error "Release state file not found: $state_path"
      return 1
    fi

    set -a
    # shellcheck disable=SC1090
    . "$state_path"
    set +a
  }

  write_staging_verification_state() {
    local state_path="$1"

    mkdir -p "$(dirname "$state_path")"

    cat > "$state_path" <<EOF
STAGING_VERIFIED_AT=${STAGING_VERIFIED_AT:-}
STAGING_VERIFIED_BY=${STAGING_VERIFIED_BY:-}
STAGING_VERIFIED_APP_SHA=${STAGING_VERIFIED_APP_SHA:-}
STAGING_VERIFIED_OPENPATH_SHA=${STAGING_VERIFIED_OPENPATH_SHA:-}
STAGING_VERIFIED_IMAGE_SOURCE=${STAGING_VERIFIED_IMAGE_SOURCE:-}
STAGING_VERIFIED_GATEWAY_IMAGE=${STAGING_VERIFIED_GATEWAY_IMAGE:-}
STAGING_VERIFIED_MIGRATIONS_IMAGE=${STAGING_VERIFIED_MIGRATIONS_IMAGE:-}
STAGING_VERIFIED_OPENPATH_API_IMAGE=${STAGING_VERIFIED_OPENPATH_API_IMAGE:-}
STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION=${STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION:-}
STAGING_VERIFIED_SPA_IMAGE=${STAGING_VERIFIED_SPA_IMAGE:-}
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=${STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS:-}
STAGING_SMOKE_RESULT=${STAGING_SMOKE_RESULT:-}
STAGING_SMOKE_STATUS=${STAGING_SMOKE_STATUS:-}
STAGING_RELEASE_GATE_RESULT=${STAGING_RELEASE_GATE_RESULT:-}
STAGING_WINDOWS_BOOTSTRAP_RESULT=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-}
STAGING_FIREFOX_POLICY_RESULT=${STAGING_FIREFOX_POLICY_RESULT:-}
STAGING_FIREFOX_EXTENSION_ID=${STAGING_FIREFOX_EXTENSION_ID:-}
STAGING_FIREFOX_RELEASE_VERSION=${STAGING_FIREFOX_RELEASE_VERSION:-}
STAGING_FIREFOX_METADATA_SHA256=${STAGING_FIREFOX_METADATA_SHA256:-}
STAGING_FIREFOX_XPI_SHA256=${STAGING_FIREFOX_XPI_SHA256:-}
EOF
  }
else
  # shellcheck source=lib/release-state.sh
  source "$RELEASE_STATE_HELPER_PATH"
fi

mkdir -p "$STATE_DIR"

if [ ! -f "$STATE_DIR/current-images.env" ]; then
  echo "current-images.env is missing"
  exit 1
fi

load_release_state_env "$STATE_DIR/current-images.env"

OPENPATH_SHA="$(git -C "$APP_DIR/upstream/openpath" rev-parse HEAD)"

STAGING_VERIFIED_AT="$STAGING_VERIFIED_AT" \
STAGING_VERIFIED_BY="deploy-staging-local.sh" \
STAGING_VERIFIED_APP_SHA="${APP_SHA:-}" \
STAGING_VERIFIED_OPENPATH_SHA="${OPENPATH_SHA:-}" \
STAGING_VERIFIED_IMAGE_SOURCE="${IMAGE_SOURCE:-}" \
STAGING_VERIFIED_GATEWAY_IMAGE="${CLASSROOMPATH_GATEWAY_IMAGE:-}" \
STAGING_VERIFIED_MIGRATIONS_IMAGE="${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" \
STAGING_VERIFIED_OPENPATH_API_IMAGE="${OPENPATH_API_IMAGE:-}" \
STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION="${OPENPATH_LINUX_AGENT_VERSION:-}" \
STAGING_VERIFIED_SPA_IMAGE="${CLASSROOMPATH_SPA_IMAGE:-}" \
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS \
STAGING_SMOKE_RESULT=success \
STAGING_SMOKE_STATUS="$STAGING_SMOKE_STATUS" \
STAGING_RELEASE_GATE_RESULT=success \
STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT \
STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT \
STAGING_FIREFOX_EXTENSION_ID=$STAGING_FIREFOX_EXTENSION_ID \
STAGING_FIREFOX_RELEASE_VERSION=$STAGING_FIREFOX_RELEASE_VERSION \
STAGING_FIREFOX_METADATA_SHA256=$STAGING_FIREFOX_METADATA_SHA256 \
STAGING_FIREFOX_XPI_SHA256=$STAGING_FIREFOX_XPI_SHA256 \
  write_staging_verification_state "$STATE_DIR/staging-verification.env"
