#!/bin/bash

run_staging_local_health_checks() {
    log_info "Running health checks..."

    local health_check_output=""
    if ! health_check_output="$(bash "$STAGING_HEALTH_CHECK_SCRIPT_PATH" "$STAGING_HOST" "${SSH_CMD[@]}" 2>&1)"; then
        printf '%s\n' "$health_check_output" >&2
        exit 1
    fi

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        log_success "$line"
    done <<< "$health_check_output"

    STAGING_DEPLOY_IMAGE_SOURCE=$("${SSH_CMD[@]}" "awk -F= '/^IMAGE_SOURCE=/{print \$2}' /opt/classroompath/release-state/current-images.env 2>/dev/null || true")
    if [ -n "$STAGING_DEPLOY_IMAGE_SOURCE" ]; then
        log_info "Staging image source: $STAGING_DEPLOY_IMAGE_SOURCE"
    fi
}

build_staging_verify_state_env_cmd() {
    cat <<EOF
$(remote_assignment STATE_DIR "$STATE_DIR")$(remote_assignment APP_DIR "$APP_DIR")$(remote_assignment STAGING_VERIFIED_AT "${STAGING_VERIFIED_AT:-}")$(remote_assignment STAGING_EMAIL_PREFLIGHT_MODE "${CP_EMAIL_PREFLIGHT_MODE:-required}")$(remote_assignment STAGING_EMAIL_DELIVERY_HIGH_RISK "${STAGING_EMAIL_DELIVERY_HIGH_RISK:-unknown}")$(remote_assignment STAGING_EMAIL_PREFLIGHT_RESULT "${STAGING_EMAIL_PREFLIGHT_RESULT:-unknown}")$(remote_assignment STAGING_EMAIL_PREFLIGHT_PROVIDER "${STAGING_EMAIL_PREFLIGHT_PROVIDER:-unknown}")$(remote_assignment STAGING_WINDOWS_FIREFOX_HIGH_RISK "${STAGING_WINDOWS_FIREFOX_HIGH_RISK:-unknown}")$(remote_assignment STAGING_SMOKE_RESULT "${STAGING_SMOKE_RESULT:-}")$(remote_assignment STAGING_SMOKE_STATUS "${STAGING_SMOKE_STATUS:-}")$(remote_assignment STAGING_RELEASE_GATE_RESULT "${STAGING_RELEASE_GATE_RESULT:-}")$(remote_assignment STAGING_FIREFOX_RELEASE_ARTIFACTS "${STAGING_FIREFOX_RELEASE_ARTIFACTS:-}")$(remote_assignment STAGING_WINDOWS_BOOTSTRAP_RESULT "${STAGING_WINDOWS_BOOTSTRAP_RESULT:-}")$(remote_assignment STAGING_FIREFOX_POLICY_RESULT "${STAGING_FIREFOX_POLICY_RESULT:-}")$(remote_assignment STAGING_FIREFOX_EXTENSION_ID "${STAGING_FIREFOX_EXTENSION_ID:-}")$(remote_assignment STAGING_FIREFOX_RELEASE_VERSION "${STAGING_FIREFOX_RELEASE_VERSION:-}")$(remote_assignment STAGING_FIREFOX_METADATA_SHA256 "${STAGING_FIREFOX_METADATA_SHA256:-}")$(remote_assignment STAGING_FIREFOX_XPI_SHA256 "${STAGING_FIREFOX_XPI_SHA256:-}")
$(remote_assignment STAGING_LINUX_BOOTSTRAP_RESULT "${STAGING_LINUX_BOOTSTRAP_RESULT:-}")$(remote_assignment STAGING_LINUX_BOOTSTRAP_RUN_ID "${STAGING_LINUX_BOOTSTRAP_RUN_ID:-}")$(remote_assignment STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID "${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID:-}")$(remote_assignment STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE "${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:-}")
EOF
}

mark_staging_local_verification_failed() {
    local deploy_context_file="$STATE_DIR/staging-deploy-context.env"
    local marker_output=""
    local marker_env_cmd=""

    marker_env_cmd="$(remote_assignment STATE_DIR "$STATE_DIR")$(remote_assignment APP_DIR "$APP_DIR")$(remote_assignment DEPLOY_CONTEXT_FILE "$deploy_context_file")"

    if marker_output="$("${SSH_CMD[@]}" "${marker_env_cmd}bash -s" 2>&1 <<'REMOTE_MARKER'
set -euo pipefail

COMMON_SH_PATH="$APP_DIR/scripts/lib/common.sh"
RELEASE_STATE_SH_PATH="$APP_DIR/scripts/lib/release-state.sh"

if [ -f "$COMMON_SH_PATH" ]; then
  # shellcheck disable=SC1090
  source "$COMMON_SH_PATH"
fi

if [ ! -f "$RELEASE_STATE_SH_PATH" ]; then
  echo "release-state helper not found at $RELEASE_STATE_SH_PATH" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$RELEASE_STATE_SH_PATH"

if [ -f "$DEPLOY_CONTEXT_FILE" ]; then
  load_release_state_env "$DEPLOY_CONTEXT_FILE" || true
fi

if [ -f "$STATE_DIR/current-images.env" ]; then
  # shellcheck disable=SC1090
  source "$STATE_DIR/current-images.env"
fi

TARGET_SHA="${TARGET_SHA:-${APP_SHA:-}}"
APP_SHA="${APP_SHA:-}"
PREVIOUS_APP_SHA="${PREVIOUS_APP_SHA:-}"
IMAGE_SOURCE="${IMAGE_SOURCE:-}"
MIGRATION_RISK_LEVEL="${MIGRATION_RISK_LEVEL:-unknown}"
MIGRATION_CHANGED_FILES="${MIGRATION_CHANGED_FILES:-}"
MIGRATION_DESTRUCTIVE_FILES="${MIGRATION_DESTRUCTIVE_FILES:-}"
PRODUCTION_BACKUP_REFERENCE="${PRODUCTION_BACKUP_REFERENCE:-}"
DB_MIGRATED="${DB_MIGRATED:-0}"
FAILURE_STAGE="verification"
DEPLOY_FAILURE_STAGE="verification"
ROLLBACK_ATTEMPTED="${ROLLBACK_ATTEMPTED:-0}"
ROLLBACK_RESULT="${ROLLBACK_RESULT:-not_attempted}"

write_deploy_context_state "$DEPLOY_CONTEXT_FILE"
REMOTE_MARKER
    )"; then
        log_info "Staging deploy context marked as verification failure"
    else
        log_warn "Unable to mark staging deploy context as verification failure"
        if [ -n "$marker_output" ]; then
            printf '%s\n' "$marker_output" >&2
        fi
    fi
}

run_staging_local_verification() {
    log_info "Running staging verification against staging..."

    VERIFICATION_STATE_FILE="$(mktemp)"
    STAGING_GATE_RESULT="skipped"

    if [ "$STAGING_RUN_RELEASE_GATE" = "1" ]; then
        if ! bash "$STAGING_VERIFICATION_RUNNER_PATH" collect "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "$CANONICAL_STAGING_URL" "$STAGING_USE_RELEASE_CANDIDATE" "${SSH_CMD[@]}"; then
            mark_staging_local_verification_failed
            exit 1
        fi

        set -a
        . "$VERIFICATION_STATE_FILE"
        set +a
        STAGING_GATE_RESULT="success"

        log_info "Persisting staging verification evidence..."

        local verify_state_env_cmd=""
        verify_state_env_cmd="$(build_staging_verify_state_env_cmd)"
        "${SSH_CMD[@]}" "${verify_state_env_cmd}bash -s" < "$STAGING_VERIFY_STATE_SCRIPT_PATH"

        log_success "Staging verification evidence saved"
    else
        log_warn "Skipping staging release gate because STAGING_RUN_RELEASE_GATE=$STAGING_RUN_RELEASE_GATE"
        log_warn "Production tag workflow will fail until staging verification evidence is refreshed"

        if ! bash "$STAGING_VERIFICATION_RUNNER_PATH" smoke "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "${SSH_CMD[@]}"; then
            mark_staging_local_verification_failed
            exit 1
        fi

        set -a
        . "$VERIFICATION_STATE_FILE"
        set +a
    fi
}

print_staging_local_summary() {
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))

    echo ""
    echo "========================================"
    log_success "Staging deployment + smoke tests complete!"
    echo "========================================"
    echo ""
    echo "  Duration: ${DURATION}s"
    echo "  URL: $SMOKE_TARGET_URL"
    echo "  Verification Status: $STAGING_SMOKE_STATUS"
    echo "  Release Gate: $STAGING_GATE_RESULT"
    if [ -n "${STAGING_DEPLOY_IMAGE_SOURCE:-}" ]; then
        echo "  Image Source: $STAGING_DEPLOY_IMAGE_SOURCE"
    fi
    echo "  Gateway: http://$STAGING_HOST:3001/cp/health"
    echo "  API: http://$STAGING_HOST:3000/health"
    if [ "$STAGING_SMOKE_STATUS" = "PASS_WITH_FALLBACK" ]; then
        echo "  Note: public-domain smoke required direct-IP fallback; rerun strict smoke before production promotion."
    fi
    echo ""
    echo "  All smoke tests passed - deployment verified!"
    echo ""
}
