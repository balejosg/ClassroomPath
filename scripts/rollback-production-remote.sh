#!/usr/bin/env bash

set -euo pipefail

: "${CLASSROOMPATH_DEPLOY_ROOT:?Set CLASSROOMPATH_DEPLOY_ROOT to the private production deploy root.}"
APP_DIR="${APP_DIR:-$CLASSROOMPATH_DEPLOY_ROOT/app}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  # A streamed rollback without BASH_SOURCE must use the transmitted or
  # durable recovery artifact below; APP_DIR is never an executable fallback.
  SCRIPT_DIR=""
fi

# Production rollback must never resolve executable code from APP_DIR. The
# action transmits this bundle from the runner; a durable management copy or a
# checked-out local sibling is accepted only when it already contains the
# complete stable bundle.
RECOVERY_EXECUTOR_NAME="production-recovery-executor.sh"
RECOVERY_BUNDLE_DIR=""
RECOVERY_BUNDLE_ROOT=""
RECOVERY_EXECUTOR_PATH=""
RECOVERY_REQUIRED_FILES=(
  "$RECOVERY_EXECUTOR_NAME"
  lib/common.sh
  lib/remote-bootstrap.sh
  lib/remote-deploy-scaffold.sh
  lib/remote-helper-contracts.sh
  lib/release-state.sh
  lib/release-runtime.sh
  lib/deployment-state.sh
  lib/production-host-contract.sh
  lib/deployment-transaction.sh
  lib/rollback-executor.sh
  lib/rollback-readiness.sh
  lib/deploy-container-platform.sh
)

recovery_executor_is_candidate_path() {
  local executor_path="$1"

  case "$executor_path" in
    "$APP_DIR"|"$APP_DIR"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

cleanup_recovery_bundle() {
  if [ -n "$RECOVERY_BUNDLE_DIR" ] && [ -d "$RECOVERY_BUNDLE_DIR" ]; then
    rm -rf "$RECOVERY_BUNDLE_DIR"
  fi
}

trap cleanup_recovery_bundle EXIT

recovery_bundle_is_complete() {
  local bundle_root="$1"
  local required_file=""
  local required_path=""
  local executor_in_lib=0

  if [ ! -f "$bundle_root/$RECOVERY_EXECUTOR_NAME" ] &&
    [ -f "$bundle_root/lib/$RECOVERY_EXECUTOR_NAME" ]; then
    executor_in_lib=1
  fi
  for required_file in "${RECOVERY_REQUIRED_FILES[@]}"; do
    required_path="$bundle_root/$required_file"
    if [ "$executor_in_lib" -eq 1 ] && [ "$required_file" = "$RECOVERY_EXECUTOR_NAME" ]; then
      required_path="$bundle_root/lib/$required_file"
    fi
    if [ ! -f "$required_path" ]; then
      printf 'Production recovery bundle is incomplete: %s\n' "$required_path" >&2
      return 1
    fi
  done
}

recovery_archive_has_safe_paths() {
  local archive_path="$1"
  local archive_entry=""

  while IFS= read -r archive_entry; do
    case "$archive_entry" in
      production-recovery-executor.sh|lib|lib/*.sh|lib/)
        ;;
      *)
        printf 'Production recovery bundle contains an unexpected path: %s\n' "$archive_entry" >&2
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive_path")
}

stage_transmitted_recovery_bundle() {
  local bundle_archive=""

  RECOVERY_BUNDLE_DIR="$(mktemp -d "$CLASSROOMPATH_DEPLOY_ROOT/.recovery-executor.XXXXXX")"
  bundle_archive="$RECOVERY_BUNDLE_DIR/recovery.tgz"
  if ! printf '%s' "${PRODUCTION_RECOVERY_BUNDLE_B64:-}" | base64 --decode > "$bundle_archive"; then
    printf 'Unable to decode the transmitted production recovery bundle\n' >&2
    return 1
  fi
  recovery_archive_has_safe_paths "$bundle_archive" || return 1
  if ! tar -xzf "$bundle_archive" -C "$RECOVERY_BUNDLE_DIR" --no-same-owner --no-same-permissions; then
    printf 'Unable to extract the transmitted production recovery bundle\n' >&2
    return 1
  fi
  rm -f "$bundle_archive"
  recovery_bundle_is_complete "$RECOVERY_BUNDLE_DIR" || return 1
  RECOVERY_EXECUTOR_PATH="$RECOVERY_BUNDLE_DIR/$RECOVERY_EXECUTOR_NAME"
  RECOVERY_BUNDLE_ROOT="$RECOVERY_BUNDLE_DIR"
}

set_recovery_bundle_root_for_executor() {
  local executor_path="$1"
  local executor_dir=""

  executor_dir="$(cd "$(dirname "$executor_path")" && pwd)"

  if [ "$(basename "$executor_dir")" = "lib" ] && [ -f "$executor_dir/common.sh" ]; then
    RECOVERY_BUNDLE_ROOT="$(cd "$executor_dir/.." && pwd)"
  else
    RECOVERY_BUNDLE_ROOT="$executor_dir"
  fi
}

if [ -n "${PRODUCTION_RECOVERY_EXECUTOR_PATH:-}" ]; then
  if recovery_executor_is_candidate_path "$PRODUCTION_RECOVERY_EXECUTOR_PATH"; then
    printf 'Production recovery executor must not be resolved from APP_DIR: %s\n' \
      "$PRODUCTION_RECOVERY_EXECUTOR_PATH" >&2
    exit 1
  fi
  RECOVERY_EXECUTOR_PATH="$PRODUCTION_RECOVERY_EXECUTOR_PATH"
  set_recovery_bundle_root_for_executor "$RECOVERY_EXECUTOR_PATH"
elif [ -n "$SCRIPT_DIR" ] &&
  [ -f "$SCRIPT_DIR/lib/$RECOVERY_EXECUTOR_NAME" ] &&
  ! recovery_executor_is_candidate_path "$SCRIPT_DIR/lib/$RECOVERY_EXECUTOR_NAME"; then
  RECOVERY_EXECUTOR_PATH="$SCRIPT_DIR/lib/$RECOVERY_EXECUTOR_NAME"
  RECOVERY_BUNDLE_ROOT="$SCRIPT_DIR"
elif [ -n "${PRODUCTION_RECOVERY_BUNDLE_B64:-}" ]; then
  stage_transmitted_recovery_bundle
elif [ -f "$CLASSROOMPATH_DEPLOY_ROOT/recovery/current/$RECOVERY_EXECUTOR_NAME" ]; then
  RECOVERY_EXECUTOR_PATH="$CLASSROOMPATH_DEPLOY_ROOT/recovery/current/$RECOVERY_EXECUTOR_NAME"
  RECOVERY_BUNDLE_ROOT="$CLASSROOMPATH_DEPLOY_ROOT/recovery/current"
else
  printf 'A stable production recovery bundle is required; APP_DIR is not a recovery source\n' >&2
  exit 1
fi

recovery_bundle_is_complete "$RECOVERY_BUNDLE_ROOT"

if bash "$RECOVERY_EXECUTOR_PATH"; then
  recovery_status=0
else
  recovery_status=$?
fi
exit "$recovery_status"
