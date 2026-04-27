#!/usr/bin/env bash
# release-execution.sh - Shared release transition, risk, and recovery helpers
# shellcheck shell=bash

RELEASE_EXECUTION_HELPER_CONTRACT_VERSION=1

release_execution_scripts_dir() {
  local script_source="${BASH_SOURCE[0]:-}"
  local lib_dir=""

  if [ -n "$script_source" ]; then
    lib_dir="$(cd "$(dirname "$script_source")" && pwd)"
  else
    lib_dir="$(pwd)/scripts/lib"
  fi

  printf '%s\n' "$(cd "$lib_dir/.." && pwd)"
}

release_execution_init_context() {
  DEPLOY_CONTEXT_FILE="$1"
  ROLLBACK_ATTEMPTED="${ROLLBACK_ATTEMPTED:-0}"
  ROLLBACK_RESULT="${ROLLBACK_RESULT:-not_attempted}"
  FAILURE_STAGE="${FAILURE_STAGE:-${DEPLOY_FAILURE_STAGE:-preflight}}"
  DEPLOY_FAILURE_STAGE="${DEPLOY_FAILURE_STAGE:-$FAILURE_STAGE}"
}

release_execution_normalize_stage() {
  local stage="$1"

  case "$stage" in
    preflight|migrations|startup|readiness|completed|failed|verification)
      printf '%s\n' "$stage"
      ;;
    *)
      if declare -f die >/dev/null 2>&1; then
        die "Unknown release execution stage: $stage" 1
      fi
      printf 'Unknown release execution stage: %s\n' "$stage" >&2
      return 1
      ;;
  esac
}

release_execution_write_deploy_context() {
  local state_path="${1:-${DEPLOY_CONTEXT_FILE:-}}"
  local app_sha="${APP_SHA:-${TARGET_SHA:-${STAGING_RELEASE_SHA:-origin-main}}}"
  local target_sha="${TARGET_SHA:-$app_sha}"

  if [ -z "$state_path" ]; then
    if declare -f die >/dev/null 2>&1; then
      die "DEPLOY_CONTEXT_FILE is required before writing deploy context" 1
    fi
    printf 'DEPLOY_CONTEXT_FILE is required before writing deploy context\n' >&2
    return 1
  fi

  TARGET_SHA="$target_sha" \
  APP_SHA="$app_sha" \
  IMAGE_SOURCE="${IMAGE_SOURCE:-}" \
  PREVIOUS_APP_SHA="${PREVIOUS_APP_SHA:-}" \
  MIGRATION_RISK_LEVEL="${MIGRATION_RISK_LEVEL:-safe}" \
  MIGRATION_CHANGED_FILES="${MIGRATION_CHANGED_FILES:-}" \
  MIGRATION_DESTRUCTIVE_FILES="${MIGRATION_DESTRUCTIVE_FILES:-}" \
  PRODUCTION_BACKUP_REFERENCE="${PRODUCTION_BACKUP_REFERENCE:-}" \
  DB_MIGRATED="${DB_MIGRATED:-0}" \
  FAILURE_STAGE="${FAILURE_STAGE:-${DEPLOY_FAILURE_STAGE:-preflight}}" \
  DEPLOY_FAILURE_STAGE="${DEPLOY_FAILURE_STAGE:-${FAILURE_STAGE:-preflight}}" \
  ROLLBACK_ATTEMPTED="${ROLLBACK_ATTEMPTED:-0}" \
  ROLLBACK_RESULT="${ROLLBACK_RESULT:-not_attempted}" \
    write_deploy_context_state "$state_path"
}

release_execution_mark_stage() {
  local stage=""

  stage="$(release_execution_normalize_stage "$1")" || return 1
  FAILURE_STAGE="$stage"
  DEPLOY_FAILURE_STAGE="$stage"

  if [ -n "${DEPLOY_CONTEXT_FILE:-}" ] && declare -f write_deploy_context_state >/dev/null 2>&1; then
    release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
  fi
}

release_execution_classify_migration_risk() {
  local repo_root="$1"
  local from_ref="$2"
  local to_ref="$3"
  local classifier_path=""

  classifier_path="$(release_execution_scripts_dir)/classify-migration-risk.mjs"
  eval "$(node "$classifier_path" --repo-root "$repo_root" --from "$from_ref" --to "$to_ref")"
}

release_execution_require_production_backup() {
  if [ "${MIGRATION_RISK_LEVEL:-safe}" != "destructive" ]; then
    return 0
  fi

  if [ -n "${PRODUCTION_DB_BACKUP_COMMAND:-}" ]; then
    if declare -f log_info >/dev/null 2>&1; then
      log_info "Creating production backup using PRODUCTION_DB_BACKUP_COMMAND..."
    fi
    PRODUCTION_BACKUP_REFERENCE="$(sh -lc "$PRODUCTION_DB_BACKUP_COMMAND")"
  elif [ -n "${PRODUCTION_DB_BACKUP_ID:-}" ]; then
    PRODUCTION_BACKUP_REFERENCE="$PRODUCTION_DB_BACKUP_ID"
  else
    die "Destructive migrations require PRODUCTION_DB_BACKUP_ID or PRODUCTION_DB_BACKUP_COMMAND" 1
  fi

  if [ -z "$PRODUCTION_BACKUP_REFERENCE" ]; then
    die "Backup command did not return a backup identifier" 1
  fi

  if declare -f log_info >/dev/null 2>&1; then
    log_info "Recorded production backup reference: $PRODUCTION_BACKUP_REFERENCE"
  fi
}

release_execution_classify_and_gate_production_migrations() {
  deployment_state_capture_previous_release
  release_execution_classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"

  if [ "${MIGRATION_RISK_LEVEL:-safe}" = "destructive" ] && declare -f log_warn >/dev/null 2>&1; then
    log_warn "Destructive migration risk detected: ${MIGRATION_DESTRUCTIVE_FILES:-unknown files}"
  fi

  release_execution_require_production_backup
  release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
}

release_execution_staging_restore_is_eligible() {
  local stage="${FAILURE_STAGE:-${DEPLOY_FAILURE_STAGE:-}}"

  [ "${DB_MIGRATED:-0}" = "1" ] || return 1

  case "$stage" in
    startup|readiness)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

release_execution_production_rollback_is_eligible() {
  local deploy_result="${1:-}"
  local smoke_result="${2:-}"
  local windows_canary_result="${3:-}"

  [ "$deploy_result" = "failure" ] || [ "$smoke_result" = "failure" ] || [ "$windows_canary_result" = "failure" ]
}
