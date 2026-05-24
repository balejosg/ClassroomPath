#!/usr/bin/env bash
# release-risk-policy.sh - Shared release risk and recovery policy predicates
# shellcheck shell=bash

RELEASE_RISK_POLICY_HELPER_CONTRACT_VERSION=1

release_risk_policy_production_backup_is_required() {
  [ "${MIGRATION_RISK_LEVEL:-safe}" = "destructive" ]
}

release_risk_policy_classify_sql_migration_file_fallback() {
  local path="$1"

  if grep -Eiq '\b(DELETE[[:space:]]+FROM|TRUNCATE|DROP[[:space:]]+(TABLE|INDEX|COLUMN|CONSTRAINT))\b' "$path"; then
    printf '%s\n' "destructive"
    return 0
  fi

  if grep -Eiq '\bALTER[[:space:]]+TABLE\b' "$path" \
    && grep -Eiq '\b(DROP|ALTER[[:space:]]+COLUMN[[:space:][:alnum:]_"]*[[:space:]]+TYPE|SET[[:space:]]+DATA[[:space:]]+TYPE)\b' "$path"; then
    printf '%s\n' "destructive"
    return 0
  fi

  if grep -Eiq '\bUPDATE\b' "$path" && grep -Eiq '\bSET\b' "$path"; then
    printf '%s\n' "destructive"
    return 0
  fi

  if grep -Eiq '\b(CREATE[[:space:]]+TABLE|CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX)\b' "$path"; then
    printf '%s\n' "expand-contract"
    return 0
  fi

  if grep -Eiq '\bALTER[[:space:]]+TABLE\b' "$path" \
    && grep -Eiq '\bADD[[:space:]]+(COLUMN|CONSTRAINT)\b' "$path"; then
    printf '%s\n' "expand-contract"
    return 0
  fi

  printf '%s\n' "safe"
}

release_risk_policy_classify_migration_risk_without_node() {
  local repo_root="$1"
  local from_ref="$2"
  local to_ref="$3"
  local -a changed_files=()
  local -a destructive_files=()
  local -a expand_files=()
  local -a safe_files=()
  local file=""
  local risk="safe"

  if [ -z "$from_ref" ] || [ -z "$to_ref" ] || [ "$from_ref" = "$to_ref" ]; then
    MIGRATION_RISK_LEVEL="safe"
    MIGRATION_CHANGED_FILES=""
    MIGRATION_DESTRUCTIVE_FILES=""
    MIGRATION_EXPAND_FILES=""
    MIGRATION_SAFE_FILES=""
    return 0
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    changed_files+=("$file")
  done < <(
    git -C "$repo_root" diff --name-only "${from_ref}..${to_ref}" -- \
      'api/drizzle/*.sql' \
      'upstream/openpath/api/drizzle/*.sql'
  )

  for file in "${changed_files[@]}"; do
    risk="$(release_risk_policy_classify_sql_migration_file_fallback "$repo_root/$file")"
    case "$risk" in
      destructive)
        destructive_files+=("$file")
        ;;
      expand-contract)
        expand_files+=("$file")
        ;;
      safe)
        safe_files+=("$file")
        ;;
    esac
  done

  if [ "${#destructive_files[@]}" -gt 0 ]; then
    MIGRATION_RISK_LEVEL="destructive"
  elif [ "${#expand_files[@]}" -gt 0 ]; then
    MIGRATION_RISK_LEVEL="expand-contract"
  else
    MIGRATION_RISK_LEVEL="safe"
  fi

  MIGRATION_CHANGED_FILES="$(IFS=,; printf '%s' "${changed_files[*]}")"
  MIGRATION_DESTRUCTIVE_FILES="$(IFS=,; printf '%s' "${destructive_files[*]}")"
  MIGRATION_EXPAND_FILES="$(IFS=,; printf '%s' "${expand_files[*]}")"
  MIGRATION_SAFE_FILES="$(IFS=,; printf '%s' "${safe_files[*]}")"
}

release_risk_policy_require_production_backup() {
  if ! release_risk_policy_production_backup_is_required; then
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

release_risk_policy_staging_restore_is_eligible() {
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

release_risk_policy_production_rollback_is_eligible() {
  local deploy_result="${1:-}"
  local smoke_result="${2:-}"
  local windows_canary_result="${3:-}"

  [ "$deploy_result" = "failure" ] || [ "$smoke_result" = "failure" ] || [ "$windows_canary_result" = "failure" ]
}
