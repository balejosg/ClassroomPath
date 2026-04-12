#!/usr/bin/env bash
# shellcheck shell=bash

write_deploy_context() {
  TARGET_SHA="$TARGET_SHA" \
  PREVIOUS_APP_SHA="${PREVIOUS_APP_SHA:-}" \
  MIGRATION_RISK_LEVEL="${MIGRATION_RISK_LEVEL:-safe}" \
  MIGRATION_CHANGED_FILES="${MIGRATION_CHANGED_FILES:-}" \
  MIGRATION_DESTRUCTIVE_FILES="${MIGRATION_DESTRUCTIVE_FILES:-}" \
  PRODUCTION_BACKUP_REFERENCE="${PRODUCTION_BACKUP_REFERENCE:-}" \
  DB_MIGRATED="${DB_MIGRATED:-0}" \
  DEPLOY_FAILURE_STAGE="${DEPLOY_FAILURE_STAGE:-preflight}" \
    write_deploy_context_state "$DEPLOY_CONTEXT_FILE"
}

load_production_release_manifest_impl() {
  RELEASE_MANIFEST_FILE="$(mktemp)"
  local normalized_manifest_file=""
  decode_release_manifest_base64 "$RELEASE_MANIFEST_B64" "$RELEASE_MANIFEST_FILE" >/dev/null || true
  decode_release_manifest_base64 "$RELEASE_MANIFEST_B64_FROM_PAYLOAD" "$RELEASE_MANIFEST_FILE" >/dev/null
  normalized_manifest_file="$(mktemp)"
  "$(resolve_node_bin)" "$APP_DIR/scripts/lib/release-manifest.mjs" normalize \
    --file "$RELEASE_MANIFEST_FILE" \
    --output-file "$normalized_manifest_file" \
    --sha "$TARGET_SHA"
  mv "$normalized_manifest_file" "$RELEASE_MANIFEST_FILE"
  load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"
}

classify_sql_migration_file() {
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

classify_migration_risk() {
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
    risk="$(classify_sql_migration_file "$repo_root/$file")"
    case "$risk" in
      destructive)
        destructive_files+=("$file")
        ;;
      expand-contract)
        expand_files+=("$file")
        ;;
      *)
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
}

classify_production_migration_risk_impl() {
  deployment_state_capture_previous_release

  classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"

  if [ "$MIGRATION_RISK_LEVEL" = "destructive" ]; then
    log_warn "Destructive migration risk detected: ${MIGRATION_DESTRUCTIVE_FILES:-unknown files}"

    if [ -n "${PRODUCTION_DB_BACKUP_COMMAND:-}" ]; then
      log_info "Creating production backup using PRODUCTION_DB_BACKUP_COMMAND..."
      PRODUCTION_BACKUP_REFERENCE="$(sh -lc "$PRODUCTION_DB_BACKUP_COMMAND")"
    elif [ -n "${PRODUCTION_DB_BACKUP_ID:-}" ]; then
      PRODUCTION_BACKUP_REFERENCE="$PRODUCTION_DB_BACKUP_ID"
    else
      die "Destructive migrations require PRODUCTION_DB_BACKUP_ID or PRODUCTION_DB_BACKUP_COMMAND" 1
    fi

    if [ -z "$PRODUCTION_BACKUP_REFERENCE" ]; then
      die "Backup command did not return a backup identifier" 1
    fi

    log_info "Recorded production backup reference: $PRODUCTION_BACKUP_REFERENCE"
  fi

  write_deploy_context
}
