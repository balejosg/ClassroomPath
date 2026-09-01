#!/usr/bin/env bash
# production-recovery-artifact.sh - Pre-switch recovery artifact lifecycle
# shellcheck shell=bash

PRODUCTION_RECOVERY_ARTIFACT_HELPER_CONTRACT_VERSION=1
PRODUCTION_RECOVERY_ARTIFACT_CONTRACT_VERSION=1

PRODUCTION_RECOVERY_ARTIFACT_REQUIRED_FILES=(
  production-recovery-executor.sh
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

production_recovery_artifact_error() {
  if declare -f log_error >/dev/null 2>&1; then
    log_error "$*"
  else
    printf '[ERROR] %s\n' "$*" >&2
  fi
}

production_recovery_artifact_hash_file() {
  local artifact_path="$1"

  sha256sum "$artifact_path" | awk '{ print $1; exit }'
}

production_recovery_artifact_archive_has_safe_paths() {
  local archive_path="$1"
  local archive_entries=""
  local archive_entry=""

  if ! archive_entries="$(tar -tzf "$archive_path")"; then
    production_recovery_artifact_error "Unable to list the production recovery artifact"
    return 1
  fi

  while IFS= read -r archive_entry; do
    [ -n "$archive_entry" ] || continue
    case "$archive_entry" in
      production-recovery-executor.sh|lib|lib/*.sh|lib/)
        ;;
      *)
        production_recovery_artifact_error \
          "Production recovery artifact contains an unexpected path: $archive_entry"
        return 1
        ;;
    esac
  done <<< "$archive_entries"
}

production_recovery_artifact_bundle_is_complete() {
  local bundle_root="$1"
  local required_file=""

  for required_file in "${PRODUCTION_RECOVERY_ARTIFACT_REQUIRED_FILES[@]}"; do
    if [ ! -f "$bundle_root/$required_file" ]; then
      production_recovery_artifact_error \
        "Production recovery artifact is incomplete: $bundle_root/$required_file"
      return 1
    fi
  done
}

production_recovery_artifact_write_identity() {
  local identity_path="$1"
  local artifact_sha256="$2"
  local executor_sha256="$3"
  local artifact_path="$4"
  local source_sha="${5:-}"
  local identity_tmp=""

  mkdir -p "$(dirname "$identity_path")"
  identity_tmp="$(mktemp "$identity_path.tmp.XXXXXX")" || return 1
  {
    printf 'PRODUCTION_RECOVERY_ARTIFACT_VERSION=%q\n' "$PRODUCTION_RECOVERY_ARTIFACT_CONTRACT_VERSION"
    printf 'PRODUCTION_RECOVERY_ARTIFACT_SHA256=%q\n' "$artifact_sha256"
    printf 'PRODUCTION_RECOVERY_EXECUTOR_SHA256=%q\n' "$executor_sha256"
    printf 'PRODUCTION_RECOVERY_ARTIFACT_PATH=%q\n' "$artifact_path"
    printf 'PRODUCTION_RECOVERY_SOURCE_SHA=%q\n' "$source_sha"
    printf 'PRODUCTION_RECOVERY_PREFLIGHT=%q\n' passed
  } > "$identity_tmp"
  chmod 600 "$identity_tmp"
  if ! mv "$identity_tmp" "$identity_path"; then
    rm -f "$identity_tmp"
    return 1
  fi
}

production_recovery_artifact_prepare() {
  local deploy_root="${CLASSROOMPATH_DEPLOY_ROOT:-}"
  local app_dir="${APP_DIR:-${deploy_root%/}/app}"
  local bundle_base64="${PRODUCTION_RECOVERY_BUNDLE_B64:-}"
  local expected_sha256="${PRODUCTION_RECOVERY_ARTIFACT_SHA256:-}"
  local expected_executor_sha256="${PRODUCTION_RECOVERY_EXECUTOR_SHA256:-}"
  local source_sha="${PRODUCTION_RECOVERY_SOURCE_SHA:-}"
  local staging_dir=""
  local archive_path=""
  local extracted_dir=""
  local artifact_sha256=""
  local executor_sha256=""
  local recovery_root=""
  local release_root=""
  local release_tmp=""
  local identity_path=""

  if [ -z "$deploy_root" ]; then
    production_recovery_artifact_error 'CLASSROOMPATH_DEPLOY_ROOT is required for recovery artifact preparation'
    return 1
  fi
  if [ -z "$bundle_base64" ]; then
    production_recovery_artifact_error \
      'PRODUCTION_RECOVERY_BUNDLE_B64 is required before the mutation boundary'
    return 1
  fi
  if [[ ! "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    production_recovery_artifact_error \
      'PRODUCTION_RECOVERY_ARTIFACT_SHA256 must identify the exact recovery bytes'
    return 1
  fi
  if [ -n "$expected_executor_sha256" ] &&
    [[ ! "$expected_executor_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    production_recovery_artifact_error \
      'PRODUCTION_RECOVERY_EXECUTOR_SHA256 must identify the exact recovery entrypoint'
    return 1
  fi
  if ! declare -f deployment_transaction_set_recovery_artifact >/dev/null 2>&1; then
    production_recovery_artifact_error \
      'deployment transaction helper cannot persist recovery artifact identity'
    return 1
  fi

  staging_dir="$(mktemp -d "$deploy_root/.recovery-artifact.XXXXXX")" || return 1
  archive_path="$staging_dir/production-recovery-bundle.tgz"
  extracted_dir="$staging_dir/extracted"
  mkdir -p "$extracted_dir"

  if ! printf '%s' "$bundle_base64" | base64 --decode > "$archive_path"; then
    production_recovery_artifact_error 'Unable to decode the production recovery artifact'
    rm -rf "$staging_dir"
    return 1
  fi
  artifact_sha256="$(production_recovery_artifact_hash_file "$archive_path")" || {
    production_recovery_artifact_error 'Unable to hash the production recovery artifact'
    rm -rf "$staging_dir"
    return 1
  }
  if [ "$artifact_sha256" != "$expected_sha256" ]; then
    production_recovery_artifact_error \
      "Production recovery artifact hash mismatch: expected=$expected_sha256 actual=$artifact_sha256"
    rm -rf "$staging_dir"
    return 1
  fi
  if ! production_recovery_artifact_archive_has_safe_paths "$archive_path"; then
    rm -rf "$staging_dir"
    return 1
  fi
  if ! tar -xzf "$archive_path" -C "$extracted_dir" --no-same-owner --no-same-permissions; then
    production_recovery_artifact_error 'Unable to extract the production recovery artifact'
    rm -rf "$staging_dir"
    return 1
  fi
  if ! production_recovery_artifact_bundle_is_complete "$extracted_dir"; then
    rm -rf "$staging_dir"
    return 1
  fi

  executor_sha256="$(production_recovery_artifact_hash_file \
    "$extracted_dir/production-recovery-executor.sh")" || {
    production_recovery_artifact_error 'Unable to hash the recovery executor entrypoint'
    rm -rf "$staging_dir"
    return 1
  }
  if [ -n "$expected_executor_sha256" ] &&
    [ "$executor_sha256" != "$expected_executor_sha256" ]; then
    production_recovery_artifact_error \
      "Production recovery executor hash mismatch: expected=$expected_executor_sha256 actual=$executor_sha256"
    rm -rf "$staging_dir"
    return 1
  fi

  # Run the exact entrypoint from the exact extracted bytes. The stable
  # executor's preflight validates the previous pointer, stored bundle,
  # contract, and rollback plan without checking out or sourcing APP_DIR.
  if ! (
    CLASSROOMPATH_DEPLOY_ROOT="$deploy_root" \
    APP_DIR="$app_dir" \
    PRODUCTION_RECOVERY_PREFLIGHT_ONLY=1 \
    PRODUCTION_RECOVERY_ARTIFACT_SHA256="$artifact_sha256" \
      bash "$extracted_dir/production-recovery-executor.sh" --preflight-only
  ); then
    production_recovery_artifact_error 'Exact production recovery artifact preflight failed'
    rm -rf "$staging_dir"
    return 1
  fi

  recovery_root="$deploy_root/recovery/releases"
  release_root="$recovery_root/$artifact_sha256"
  mkdir -p "$recovery_root"
  if [ -e "$release_root" ]; then
    if [ ! -f "$release_root/production-recovery-bundle.tgz" ] ||
      ! cmp -s "$archive_path" "$release_root/production-recovery-bundle.tgz" ||
      ! production_recovery_artifact_bundle_is_complete "$release_root"; then
      production_recovery_artifact_error \
        "Recovery artifact identity already exists with different or incomplete bytes: $release_root"
      rm -rf "$staging_dir"
      return 1
    fi
  else
    release_tmp="$(mktemp -d "$recovery_root/.staging.XXXXXX")" || {
      rm -rf "$staging_dir"
      return 1
    }
    cp "$archive_path" "$release_tmp/production-recovery-bundle.tgz"
    cp -R "$extracted_dir/." "$release_tmp/"
    if ! mv "$release_tmp" "$release_root"; then
      rm -rf "$release_tmp" "$staging_dir"
      return 1
    fi
  fi

  identity_path="$deploy_root/recovery/current-artifact.env"
  if ! production_recovery_artifact_write_identity \
    "$identity_path" \
    "$artifact_sha256" \
    "$executor_sha256" \
    "$release_root/production-recovery-bundle.tgz" \
    "$source_sha"; then
    production_recovery_artifact_error \
      'Unable to persist the production recovery artifact identity'
    rm -rf "$staging_dir"
    return 1
  fi

  RECOVERY_ARTIFACT_VERSION="$PRODUCTION_RECOVERY_ARTIFACT_CONTRACT_VERSION"
  RECOVERY_ARTIFACT_SHA256="$artifact_sha256"
  RECOVERY_EXECUTOR_SHA256="$executor_sha256"
  RECOVERY_ARTIFACT_PATH="$release_root/production-recovery-bundle.tgz"
  RECOVERY_ARTIFACT_SOURCE_SHA="$source_sha"
  export RECOVERY_ARTIFACT_VERSION RECOVERY_ARTIFACT_SHA256 RECOVERY_EXECUTOR_SHA256
  export RECOVERY_ARTIFACT_PATH RECOVERY_ARTIFACT_SOURCE_SHA
  if ! deployment_transaction_set_recovery_artifact \
    "$RECOVERY_ARTIFACT_VERSION" \
    "$RECOVERY_ARTIFACT_SHA256" \
    "$RECOVERY_EXECUTOR_SHA256" \
    "$RECOVERY_ARTIFACT_PATH" \
    "$RECOVERY_ARTIFACT_SOURCE_SHA"; then
    production_recovery_artifact_error \
      'Unable to persist recovery artifact identity in the deployment transaction'
    rm -rf "$staging_dir"
    return 1
  fi

  rm -rf "$staging_dir"
  if declare -f log_info >/dev/null 2>&1; then
    log_info "Production recovery artifact preflighted and persisted: $artifact_sha256"
  fi
}
