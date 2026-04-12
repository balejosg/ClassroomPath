#!/usr/bin/env bash
# release-state-compat.sh - Shared shell fallback for release-state snapshot serialization
# shellcheck shell=bash

RELEASE_STATE_COMPAT_HELPER_CONTRACT_VERSION=1

if ! declare -F release_state_cli_path >/dev/null; then
  release_state_cli_path() {
    local script_source="${BASH_SOURCE[0]:-}"
    local lib_dir=""

    if [ -n "$script_source" ]; then
      lib_dir="$(cd "$(dirname "$script_source")" && pwd)"
    else
      lib_dir="$(pwd)/scripts/lib"
    fi

    printf '%s\n' "$(cd "$lib_dir/.." && pwd)/release-state-cli.mjs"
  }
fi

if ! declare -F release_state_cli_available >/dev/null; then
  release_state_cli_available() {
    command -v node >/dev/null 2>&1 && [ -f "$(release_state_cli_path)" ]
  }
fi

release_state_list_fields_compat() {
  local snapshot_type="$1"

  if release_state_cli_available; then
    node "$(release_state_cli_path)" list-fields --snapshot-type "$snapshot_type"
    return 0
  fi

  case "$snapshot_type" in
    current-runtime)
      cat <<'EOF'
APP_SHA
IMAGE_SOURCE
CLASSROOMPATH_GATEWAY_IMAGE
CLASSROOMPATH_MIGRATIONS_IMAGE
OPENPATH_API_IMAGE
OPENPATH_VERSION
OPENPATH_LINUX_AGENT_VERSION
CLASSROOMPATH_SPA_IMAGE
EOF
      ;;
    deploy-context)
      cat <<'EOF'
TARGET_SHA
APP_SHA
PREVIOUS_APP_SHA
IMAGE_SOURCE
MIGRATION_RISK_LEVEL
MIGRATION_CHANGED_FILES
MIGRATION_DESTRUCTIVE_FILES
PRODUCTION_BACKUP_REFERENCE
DB_MIGRATED
FAILURE_STAGE
DEPLOY_FAILURE_STAGE
ROLLBACK_ATTEMPTED
ROLLBACK_RESULT
EOF
      ;;
    staging-verification)
      cat <<'EOF'
STAGING_VERIFIED_AT
STAGING_VERIFIED_BY
STAGING_VERIFIED_APP_SHA
STAGING_VERIFIED_OPENPATH_SHA
STAGING_VERIFIED_IMAGE_SOURCE
STAGING_VERIFIED_GATEWAY_IMAGE
STAGING_VERIFIED_MIGRATIONS_IMAGE
STAGING_VERIFIED_OPENPATH_API_IMAGE
STAGING_VERIFIED_OPENPATH_VERSION
STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION
STAGING_VERIFIED_SPA_IMAGE
STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS
STAGING_SMOKE_RESULT
STAGING_SMOKE_STATUS
STAGING_RELEASE_GATE_RESULT
STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT
STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256
EOF
      ;;
    staging-verification-run)
      cat <<'EOF'
SMOKE_TARGET_URL
SMOKE_SKIP_CORS
STAGING_SMOKE_RESULT
STAGING_SMOKE_STATUS
RELEASE_GATE_TARGET_URL
RELEASE_GATE_EXPECTED_ORIGIN
STAGING_RELEASE_GATE_RESULT
STAGING_VERIFIED_AT
STAGING_FIREFOX_RELEASE_ARTIFACTS
STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT
STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256
EOF
      ;;
    *)
      log_error "Unknown release state snapshot type: $snapshot_type"
      return 1
      ;;
  esac
}

write_release_state_snapshot_compat() {
  local snapshot_type="$1"
  local state_path="$2"
  local field=""
  local value=""
  local -a cli_cmd=()

  if release_state_cli_available; then
    cli_cmd=(env)

    while IFS= read -r field; do
      [ -z "$field" ] && continue
      value="${!field:-}"
      cli_cmd+=("$field=$value")
    done < <(release_state_list_fields_compat "$snapshot_type")

    cli_cmd+=(
      node
      "$(release_state_cli_path)"
      write-snapshot
      --snapshot-type
      "$snapshot_type"
      --output
      "$state_path"
    )

    "${cli_cmd[@]}"
    return 0
  fi

  mkdir -p "$(dirname "$state_path")"
  : > "$state_path"

  while IFS= read -r field; do
    [ -z "$field" ] && continue
    value="${!field:-}"
    printf '%s=%q\n' "$field" "$value" >> "$state_path"
  done < <(release_state_list_fields_compat "$snapshot_type")
}

write_current_release_state() {
  local state_path="$1"
  write_release_state_snapshot_compat "current-runtime" "$state_path"
}

write_deploy_context_state() {
  local state_path="$1"
  write_release_state_snapshot_compat "deploy-context" "$state_path"
}

write_staging_verification_state() {
  local state_path="$1"
  write_release_state_snapshot_compat "staging-verification" "$state_path"
}

write_staging_verification_run_state() {
  local state_path="$1"
  write_release_state_snapshot_compat "staging-verification-run" "$state_path"
}
