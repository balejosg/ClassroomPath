#!/usr/bin/env bash

set -euo pipefail

: "${CLASSROOMPATH_DEPLOY_ROOT:?Set CLASSROOMPATH_DEPLOY_ROOT to the private production deploy root.}"
APP_DIR="${APP_DIR:-$CLASSROOMPATH_DEPLOY_ROOT/app}"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
PRODUCTION_RECOVERY_SHA="${PRODUCTION_RECOVERY_SHA:-}"

if [[ ! "$PRODUCTION_RECOVERY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'PRODUCTION_RECOVERY_SHA must be a full lowercase Git SHA-1 (40 hexadecimal characters)\n' >&2
  exit 1
fi

if [ -n "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
  # A streamed rollback without BASH_SOURCE must use the transmitted or
  # durable recovery artifact below; APP_DIR is never an executable fallback.
  SCRIPT_DIR=""
fi

# Production rollback must never resolve executable code from APP_DIR. The
# action transmits the already-approved R bundle from the runner and the host
# must have persisted the same bytes before the mutation boundary.
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
  lib/production-recovery-contract.sh
  lib/recovery-authority.env
)

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
      production-recovery-executor.sh|lib|lib/*.sh|lib/*.env|lib/)
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

recovery_require_full_sha() {
  local label="$1"
  local value="${2:-}"

  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s must be a full lowercase Git SHA-1 (40 hexadecimal characters)\n' "$label" >&2
    return 1
  fi
}

recovery_bundle_metadata_value() {
  local metadata_path="$1"
  local field_name="$2"

  [ -f "$metadata_path" ] || return 1
  awk -F= -v expected_field="$field_name" '
    $1 == expected_field {
      value = $2
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      found = 1
      exit
    }
    END {
      if (!found) exit 1
    }
  ' "$metadata_path"
}

recovery_transaction_candidate_sha() {
  local transaction_path="$CLASSROOMPATH_DEPLOY_ROOT/release-state/deployment-phase.env"

  recovery_identity_value "$transaction_path" CANDIDATE_SHA || true
}

validate_recovery_bundle_authority() {
  local bundle_root="$1"
  local metadata_path="$bundle_root/lib/recovery-authority.env"
  local contract_path="$bundle_root/lib/production-recovery-contract.sh"
  local metadata_source_sha=""
  local metadata_source_version=""
  local metadata_contract_version=""
  local contract_helper_version=""
  local contract_version=""
  local source_version=""
  local expected_source_sha="${PRODUCTION_RECOVERY_SOURCE_SHA:-}"
  local expected_source_version="${PRODUCTION_RECOVERY_SOURCE_VERSION:-}"
  local expected_contract_version="${PRODUCTION_RECOVERY_CONTRACT_VERSION:-}"

  recovery_require_full_sha PRODUCTION_RECOVERY_SOURCE_SHA "$expected_source_sha" || return 1

  metadata_source_sha="$(recovery_bundle_metadata_value \
    "$metadata_path" PRODUCTION_RECOVERY_SOURCE_SHA || true)"
  metadata_source_version="$(recovery_bundle_metadata_value \
    "$metadata_path" PRODUCTION_RECOVERY_SOURCE_VERSION || true)"
  metadata_contract_version="$(recovery_bundle_metadata_value \
    "$metadata_path" PRODUCTION_RECOVERY_CONTRACT_VERSION || true)"
  contract_helper_version="$(recovery_bundle_metadata_value \
    "$contract_path" PRODUCTION_RECOVERY_CONTRACT_HELPER_CONTRACT_VERSION || true)"
  contract_version="$(recovery_bundle_metadata_value \
    "$contract_path" PRODUCTION_RECOVERY_CONTRACT_VERSION || true)"
  source_version="$(recovery_bundle_metadata_value \
    "$contract_path" PRODUCTION_RECOVERY_SOURCE_VERSION || true)"
  if [ "$metadata_source_sha" != "$PRODUCTION_RECOVERY_SHA" ] ||
    [ "$metadata_source_sha" != "$expected_source_sha" ] ||
    [ "$metadata_source_version" != "$source_version" ] ||
    [ "$metadata_contract_version" != "$contract_version" ] ||
    [ "$contract_helper_version" != "1" ] ||
    [ "$contract_version" != "1" ] ||
    [ "$source_version" != "1" ]; then
    printf 'Recovery bundle source or contract/version metadata is incompatible\n' >&2
    return 1
  fi
  if [ -n "$expected_source_version" ] && [ "$expected_source_version" != "$metadata_source_version" ]; then
    printf 'Recovery bundle source version does not match its persisted identity\n' >&2
    return 1
  fi
  if [ -n "$expected_contract_version" ] && [ "$expected_contract_version" != "$metadata_contract_version" ]; then
    printf 'Recovery bundle contract version does not match its persisted identity\n' >&2
    return 1
  fi
  RECOVERY_SOURCE_SHA="$metadata_source_sha"
  RECOVERY_SOURCE_VERSION="$metadata_source_version"
  RECOVERY_CONTRACT_VERSION="$metadata_contract_version"
  export RECOVERY_SOURCE_SHA RECOVERY_SOURCE_VERSION RECOVERY_CONTRACT_VERSION
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
  if [[ ! "$expected_executor_sha256" =~ ^[0-9a-f]{64}$ ]]; then
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
  validate_recovery_bundle_authority "$RECOVERY_BUNDLE_DIR" || return 1
  RECOVERY_EXECUTOR_PATH="$RECOVERY_BUNDLE_DIR/$RECOVERY_EXECUTOR_NAME"
  RECOVERY_BUNDLE_ROOT="$RECOVERY_BUNDLE_DIR"
  RECOVERY_EXECUTOR_SHA256="$(recovery_artifact_hash "$RECOVERY_EXECUTOR_PATH")" || return 1
  if [ "$RECOVERY_EXECUTOR_SHA256" != "$expected_executor_sha256" ]; then
    printf 'Production recovery executor hash mismatch: expected=%s actual=%s\n' \
      "$expected_executor_sha256" "$RECOVERY_EXECUTOR_SHA256" >&2
    return 1
  fi
  export RECOVERY_EXECUTOR_SHA256
}

load_durable_recovery_identity() {
  local identity_path="$CLASSROOMPATH_DEPLOY_ROOT/recovery/current-artifact.env"
  local identity_recovery_sha=""
  local identity_version=""
  local identity_source_sha=""
  local identity_source_version=""
  local identity_contract_version=""
  local identity_artifact_sha256=""
  local identity_executor_sha256=""
  local identity_candidate_sha=""
  local identity_artifact_path=""
  local identity_preflight=""
  local expected_artifact_path=""
  local requested_source_sha="${PRODUCTION_RECOVERY_SOURCE_SHA:-}"
  local requested_source_version="${PRODUCTION_RECOVERY_SOURCE_VERSION:-}"
  local requested_contract_version="${PRODUCTION_RECOVERY_CONTRACT_VERSION:-}"

  identity_version="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_ARTIFACT_VERSION || true)"
  identity_recovery_sha="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_SHA || true)"
  identity_source_sha="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_SOURCE_SHA || true)"
  identity_source_version="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_SOURCE_VERSION || true)"
  identity_contract_version="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_CONTRACT_VERSION || true)"
  identity_artifact_sha256="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_ARTIFACT_SHA256 || true)"
  identity_executor_sha256="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_EXECUTOR_SHA256 || true)"
  identity_candidate_sha="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_CANDIDATE_SHA || true)"
  identity_artifact_path="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_ARTIFACT_PATH || true)"
  identity_preflight="$(recovery_identity_value "$identity_path" PRODUCTION_RECOVERY_PREFLIGHT || true)"
  expected_artifact_path="${CLASSROOMPATH_DEPLOY_ROOT%/}/recovery/releases/$identity_artifact_sha256/production-recovery-bundle.tgz"
  if [ "$identity_version" != "1" ] ||
    [ "$identity_recovery_sha" != "$PRODUCTION_RECOVERY_SHA" ] ||
    [ "$identity_source_sha" != "$PRODUCTION_RECOVERY_SHA" ] ||
    [ "$identity_source_version" != "1" ] ||
    [ "$identity_contract_version" != "1" ] ||
    [ "$identity_preflight" != "passed" ] ||
    [[ ! "$identity_artifact_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    [[ ! "$identity_executor_sha256" =~ ^[0-9a-f]{64}$ ]] ||
    [ "$identity_artifact_path" != "$expected_artifact_path" ] ||
    [ ! -f "$identity_artifact_path" ] ||
    { [ -n "$identity_candidate_sha" ] && [ "$identity_candidate_sha" != "$CANDIDATE_SHA" ]; } ||
    { [ -n "$requested_source_sha" ] && [ "$requested_source_sha" != "$identity_source_sha" ]; } ||
    { [ -n "$requested_source_version" ] && [ "$requested_source_version" != "$identity_source_version" ]; } ||
    { [ -n "$requested_contract_version" ] && [ "$requested_contract_version" != "$identity_contract_version" ]; } ||
    [[ "$identity_artifact_path" == "$APP_DIR" || "$identity_artifact_path" == "$APP_DIR"/* ]]; then
    printf 'Durable production recovery identity is missing or invalid\n' >&2
    return 1
  fi
  if [ -n "${PRODUCTION_RECOVERY_ARTIFACT_SHA256:-}" ] &&
    [ "$PRODUCTION_RECOVERY_ARTIFACT_SHA256" != "$identity_artifact_sha256" ]; then
    printf 'Durable production recovery artifact does not match the requested hash\n' >&2
    return 1
  fi
  if [ -n "${PRODUCTION_RECOVERY_EXECUTOR_SHA256:-}" ] &&
    [ "$PRODUCTION_RECOVERY_EXECUTOR_SHA256" != "$identity_executor_sha256" ]; then
    printf 'Durable production recovery executor does not match the requested hash\n' >&2
    return 1
  fi
  PRODUCTION_RECOVERY_ARTIFACT_SHA256="$identity_artifact_sha256"
  PRODUCTION_RECOVERY_EXECUTOR_SHA256="$identity_executor_sha256"
  PRODUCTION_RECOVERY_SOURCE_SHA="$identity_source_sha"
  PRODUCTION_RECOVERY_SOURCE_VERSION="$identity_source_version"
  PRODUCTION_RECOVERY_CONTRACT_VERSION="$identity_contract_version"
  RECOVERY_DURABLE_ARTIFACT_PATH="$identity_artifact_path"
  export PRODUCTION_RECOVERY_ARTIFACT_SHA256 PRODUCTION_RECOVERY_EXECUTOR_SHA256
  export PRODUCTION_RECOVERY_SOURCE_SHA PRODUCTION_RECOVERY_SOURCE_VERSION
  export PRODUCTION_RECOVERY_CONTRACT_VERSION
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
  if ! load_durable_recovery_identity; then
    rm -rf "$transmitted_dir"
    return 1
  fi
  if ! cmp -s "$bundle_archive" "$RECOVERY_DURABLE_ARTIFACT_PATH"; then
    printf 'Transmitted recovery bytes do not match the persisted recovery artifact\n' >&2
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
  load_durable_recovery_identity
  if ! stage_recovery_archive "$RECOVERY_DURABLE_ARTIFACT_PATH"; then
    return 1
  fi
  if [ "$RECOVERY_EXECUTOR_SHA256" != "$PRODUCTION_RECOVERY_EXECUTOR_SHA256" ]; then
    printf 'Durable production recovery executor hash does not match its identity\n' >&2
    return 1
  fi
}

CANDIDATE_SHA="${CANDIDATE_SHA:-$(recovery_transaction_candidate_sha)}"
if ! recovery_require_full_sha CANDIDATE_SHA "$CANDIDATE_SHA"; then
  exit 1
fi
if [ "$CANDIDATE_SHA" = "$PRODUCTION_RECOVERY_SHA" ]; then
  printf 'CANDIDATE_SHA must differ from PRODUCTION_RECOVERY_SHA\n' >&2
  exit 1
fi
export CANDIDATE_SHA

if [ -n "${PRODUCTION_RECOVERY_EXECUTOR_PATH:-}" ]; then
  printf 'PRODUCTION_RECOVERY_EXECUTOR_PATH is forbidden; rollback must consume the exact persisted R artifact\n' >&2
  exit 1
elif [ -n "${PRODUCTION_RECOVERY_BUNDLE_B64:-}" ]; then
  stage_transmitted_recovery_bundle
else
  stage_durable_recovery_artifact
fi

recovery_bundle_is_complete "$RECOVERY_BUNDLE_ROOT"

if CANDIDATE_SHA="$CANDIDATE_SHA" \
  PRODUCTION_RECOVERY_SHA="$PRODUCTION_RECOVERY_SHA" \
  PRODUCTION_RECOVERY_SOURCE_SHA="$RECOVERY_SOURCE_SHA" \
  PRODUCTION_RECOVERY_SOURCE_VERSION="$RECOVERY_SOURCE_VERSION" \
  PRODUCTION_RECOVERY_CONTRACT_VERSION="$RECOVERY_CONTRACT_VERSION" \
  PRODUCTION_RECOVERY_ARTIFACT_SHA256="$PRODUCTION_RECOVERY_ARTIFACT_SHA256" \
  PRODUCTION_RECOVERY_EXECUTOR_SHA256="$PRODUCTION_RECOVERY_EXECUTOR_SHA256" \
  bash "$RECOVERY_EXECUTOR_PATH"; then
  recovery_status=0
else
  recovery_status=$?
fi
exit "$recovery_status"
