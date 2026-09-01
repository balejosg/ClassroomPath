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
  local archive_entries=""

  if ! archive_entries="$(tar -tzf "$archive_path")"; then
    printf 'Unable to list the production recovery bundle\n' >&2
    return 1
  fi

  while IFS= read -r archive_entry; do
    [ -n "$archive_entry" ] || continue
    case "$archive_entry" in
      production-recovery-executor.sh|lib|lib/*.sh|lib/)
        ;;
      *)
        printf 'Production recovery bundle contains an unexpected path: %s\n' "$archive_entry" >&2
        return 1
        ;;
    esac
  done <<< "$archive_entries"
}

recovery_identity_value() {
  local identity_path="$1"
  local field_name="$2"

  [ -f "$identity_path" ] || return 1
  awk -F= -v expected_field="$field_name" \
    '$1 == expected_field { value = substr($0, index($0, "=") + 1); print value; found = 1; exit } END { exit(found ? 0 : 1) }' \
    "$identity_path"
}

recovery_artifact_hash() {
  sha256sum "$1" | awk '{ print $1; exit }'
}

stage_recovery_archive() {
  local source_archive="$1"
  local bundle_archive=""
  local actual_sha256=""
  local expected_sha256="${PRODUCTION_RECOVERY_ARTIFACT_SHA256:-}"
  local expected_executor_sha256="${PRODUCTION_RECOVERY_EXECUTOR_SHA256:-}"

  RECOVERY_BUNDLE_DIR="$(mktemp -d "$CLASSROOMPATH_DEPLOY_ROOT/.recovery-executor.XXXXXX")"
  bundle_archive="$RECOVERY_BUNDLE_DIR/recovery.tgz"
  if ! cp "$source_archive" "$bundle_archive"; then
    printf 'Unable to stage the production recovery bundle\n' >&2
    return 1
  fi
  actual_sha256="$(recovery_artifact_hash "$bundle_archive")" || {
    printf 'Unable to hash the production recovery bundle\n' >&2
    return 1
  }
  if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'An exact PRODUCTION_RECOVERY_ARTIFACT_SHA256 is required\n' >&2
    return 1
  fi
  if [ -n "$expected_executor_sha256" ] &&
    [[ ! "$expected_executor_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'PRODUCTION_RECOVERY_EXECUTOR_SHA256 is invalid\n' >&2
    return 1
  fi
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    printf 'Production recovery bundle hash mismatch: expected=%s actual=%s\n' \
      "$expected_sha256" "$actual_sha256" >&2
    return 1
  fi
  recovery_archive_has_safe_paths "$bundle_archive" || return 1
  if ! tar -xzf "$bundle_archive" -C "$RECOVERY_BUNDLE_DIR" --no-same-owner --no-same-permissions; then
    printf 'Unable to extract the production recovery bundle\n' >&2
    return 1
  fi
  recovery_bundle_is_complete "$RECOVERY_BUNDLE_DIR" || return 1
  RECOVERY_EXECUTOR_PATH="$RECOVERY_BUNDLE_DIR/$RECOVERY_EXECUTOR_NAME"
  RECOVERY_BUNDLE_ROOT="$RECOVERY_BUNDLE_DIR"
  RECOVERY_EXECUTOR_SHA256="$(recovery_artifact_hash "$RECOVERY_EXECUTOR_PATH")" || return 1
  if [ -n "$expected_executor_sha256" ] &&
    [ "$RECOVERY_EXECUTOR_SHA256" != "$expected_executor_sha256" ]; then
    printf 'Production recovery executor hash mismatch: expected=%s actual=%s\n' \
      "$expected_executor_sha256" "$RECOVERY_EXECUTOR_SHA256" >&2
    return 1
  fi
  export RECOVERY_EXECUTOR_SHA256
}

stage_transmitted_recovery_bundle() {
  local transmitted_dir=""
  local bundle_archive=""

  transmitted_dir="$(mktemp -d "$CLASSROOMPATH_DEPLOY_ROOT/.recovery-transmitted.XXXXXX")"
  bundle_archive="$transmitted_dir/recovery.tgz"
  if ! printf '%s' "${PRODUCTION_RECOVERY_BUNDLE_B64:-}" | base64 --decode > "$bundle_archive"; then
    printf 'Unable to decode the transmitted production recovery bundle\n' >&2
    rm -rf "$transmitted_dir"
    return 1
  fi
  local stage_status=0
  if stage_recovery_archive "$bundle_archive"; then
    stage_status=0
  else
    stage_status=$?
  fi
  rm -rf "$transmitted_dir"
  return "$stage_status"
}

stage_durable_recovery_artifact() {
  local identity_path="$CLASSROOMPATH_DEPLOY_ROOT/recovery/current-artifact.env"
  local artifact_path=""
  local artifact_sha256=""
  local executor_sha256=""
  local identity_version=""
  local expected_artifact_path=""

  identity_version="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_ARTIFACT_VERSION || true)"
  artifact_sha256="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_ARTIFACT_SHA256 || true)"
  executor_sha256="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_EXECUTOR_SHA256 || true)"
  artifact_path="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_ARTIFACT_PATH || true)"
  expected_artifact_path="${CLASSROOMPATH_DEPLOY_ROOT%/}/recovery/releases/$artifact_sha256/production-recovery-bundle.tgz"
  if [ "$identity_version" != "1" ] ||
    [[ ! "$artifact_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    [[ ! "$executor_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    [ -z "$artifact_path" ] ||
    [ "$artifact_path" != "$expected_artifact_path" ] ||
    [[ "$artifact_path" == "$APP_DIR" || "$artifact_path" == "$APP_DIR"/* ]]; then
    printf 'Durable production recovery artifact identity is missing or invalid\n' >&2
    return 1
  fi
  if [ -n "${PRODUCTION_RECOVERY_ARTIFACT_SHA256:-}" ] &&
    [ "$PRODUCTION_RECOVERY_ARTIFACT_SHA256" != "$artifact_sha256" ]; then
    printf 'Durable production recovery artifact does not match the requested hash\n' >&2
    return 1
  fi
  PRODUCTION_RECOVERY_ARTIFACT_SHA256="$artifact_sha256"
  export PRODUCTION_RECOVERY_ARTIFACT_SHA256
  if ! stage_recovery_archive "$artifact_path"; then
    return 1
  fi
  if [ "$RECOVERY_EXECUTOR_SHA256" != "$executor_sha256" ]; then
    printf 'Durable production recovery executor hash does not match its identity\n' >&2
    return 1
  fi
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
elif [ -f "$CLASSROOMPATH_DEPLOY_ROOT/recovery/current-artifact.env" ]; then
  stage_durable_recovery_artifact
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
