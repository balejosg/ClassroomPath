#!/bin/bash

runtime_environment_policy_script() {
    printf '%s\n' "$SCRIPT_DIR/lib/runtime-environment-policy.mjs"
}

runtime_policy() {
    node "$(runtime_environment_policy_script)" "$@"
}

has_complete_billing_env() {
    runtime_policy has-complete-billing-env
}

list_missing_billing_env() {
    runtime_policy missing-billing-env | paste -sd' ' -
}

apply_staging_email_preflight_decision() {
    local mode="$1"
    local high_risk="${2:-false}"
    local decision_output=""
    local line=""
    local key=""
    local value=""

    if ! decision_output="$(
        runtime_policy staging-email-preflight --mode "$mode" --high-risk "$high_risk" 2>/dev/null
    )"; then
        log_error "Invalid STAGING_EMAIL_PREFLIGHT_MODE: $mode"
        log_error "Allowed values: auto, required, skip"
        exit 2
    fi

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        key="${line%%=*}"
        value="${line#*=}"

        case "$key" in
            CP_EMAIL_PREFLIGHT_MODE)
                CP_EMAIL_PREFLIGHT_MODE="$value"
                ;;
            STAGING_EMAIL_DELIVERY_HIGH_RISK)
                STAGING_EMAIL_DELIVERY_HIGH_RISK="$value"
                ;;
        esac
    done <<< "$decision_output"
}

resolve_staging_email_preflight_policy() {
    local mode="${STAGING_EMAIL_PREFLIGHT_MODE:-auto}"
    local risk_output_file=""
    local high_risk=""
    local target_sha="${STAGING_RELEASE_SHA:-${REMOTE_SHA:-}}"

    case "$mode" in
        required)
            apply_staging_email_preflight_decision "$mode"
            ;;
        skip)
            apply_staging_email_preflight_decision "$mode"
            ;;
        auto)
            if [ -z "$target_sha" ] || [ "$target_sha" = "unknown" ]; then
                log_error "STAGING_EMAIL_PREFLIGHT_MODE=auto requires a resolved target SHA"
                exit 1
            fi

            risk_output_file="$(mktemp)"
            if ! TARGET_SHA="$target_sha" GITHUB_OUTPUT="$risk_output_file" bash "$SCRIPT_DIR/detect-email-delivery-risk.sh" >/dev/null; then
                rm -f "$risk_output_file"
                log_error "Unable to classify email delivery risk for $target_sha"
                exit 1
            fi

            high_risk="$(awk -F= '$1=="high_risk"{print $2}' "$risk_output_file" | tail -1)"
            rm -f "$risk_output_file"
            apply_staging_email_preflight_decision "$mode" "${high_risk:-false}"
            ;;
        *)
            log_error "Invalid STAGING_EMAIL_PREFLIGHT_MODE: $mode"
            log_error "Allowed values: auto, required, skip"
            exit 2
            ;;
    esac

    export CP_EMAIL_PREFLIGHT_MODE
    export STAGING_EMAIL_DELIVERY_HIGH_RISK
    log_info "Email delivery preflight mode: $CP_EMAIL_PREFLIGHT_MODE (high_risk=$STAGING_EMAIL_DELIVERY_HIGH_RISK)"
}

record_staging_email_preflight_result() {
    case "${CP_EMAIL_PREFLIGHT_MODE:-required}" in
        required)
            STAGING_EMAIL_PREFLIGHT_RESULT="success"
            STAGING_EMAIL_PREFLIGHT_PROVIDER="resend"
            ;;
        skip)
            STAGING_EMAIL_PREFLIGHT_RESULT="skipped-low-risk"
            STAGING_EMAIL_PREFLIGHT_PROVIDER="skipped"
            ;;
        *)
            STAGING_EMAIL_PREFLIGHT_RESULT="unknown"
            STAGING_EMAIL_PREFLIGHT_PROVIDER="unknown"
            ;;
    esac

    export STAGING_EMAIL_PREFLIGHT_RESULT
    export STAGING_EMAIL_PREFLIGHT_PROVIDER
}

hydrate_billing_env_from_remote_if_needed() {
    local remote_billing_env=""
    local line=""
    local key=""
    local value=""
    local grep_pattern=""

    if has_complete_billing_env; then
        return 0
    fi

    grep_pattern="$(runtime_policy billing-env-grep-pattern)"

    log_info "Using staging runtime billing env fallback for missing local values..."
    remote_billing_env="$("${SSH_CMD[@]}" "grep -E \"$grep_pattern\" \"$APP_DIR/config/.env\" 2>/dev/null || true")"

    while IFS= read -r line; do
        [ -z "$line" ] && continue
        key="${line%%=*}"
        value="${line#*=}"

        if [ -z "${!key:-}" ]; then
            printf -v "$key" '%s' "$value"
            export "$key"
        fi
    done <<< "$remote_billing_env"

    if has_complete_billing_env; then
        return 0
    fi

    log_error "Missing billing env after checking local overrides and staging runtime fallback"
    log_error "Required values still missing: $(list_missing_billing_env)"
    exit 1
}

validate_staging_local_support_files() {
    if [ ! -f "$STAGING_REMOTE_SCRIPT_PATH" ]; then
        log_error "Remote staging deploy script not found: $STAGING_REMOTE_SCRIPT_PATH"
        exit 1
    fi

    if [ ! -f "$STAGING_HEALTH_CHECK_SCRIPT_PATH" ]; then
        log_error "Staging health helper script not found: $STAGING_HEALTH_CHECK_SCRIPT_PATH"
        exit 1
    fi

    if [ ! -f "$STAGING_VERIFY_STATE_SCRIPT_PATH" ]; then
        log_error "Staging verification persistence script not found: $STAGING_VERIFY_STATE_SCRIPT_PATH"
        exit 1
    fi

    if [ ! -f "$STAGING_VERIFICATION_RUNNER_PATH" ]; then
        log_error "Staging verification runner script not found: $STAGING_VERIFICATION_RUNNER_PATH"
        exit 1
    fi
}

build_staging_remote_env_cmd() {
    local runtime_env_assignments=""
    local runtime_env_name=""

    while IFS= read -r runtime_env_name; do
        [ -z "$runtime_env_name" ] && continue
        runtime_env_assignments+="$(remote_assignment "$runtime_env_name" "${!runtime_env_name:-}")"
    done < <(runtime_policy billing-env-names)

    cat <<EOF
$(remote_assignment STAGING_IMAGE_MODE "$STAGING_IMAGE_MODE")$(remote_assignment STAGING_USE_RELEASE_CANDIDATE "$STAGING_USE_RELEASE_CANDIDATE")$(remote_assignment STAGING_RELEASE_SHA "$STAGING_RELEASE_SHA")$(remote_assignment STAGING_RELEASE_RUN_ID "$STAGING_RELEASE_RUN_ID")$(remote_assignment STAGING_RELEASE_REPOSITORY "$STAGING_RELEASE_REPOSITORY")$(remote_assignment STAGING_RELEASE_ID "${STAGING_RELEASE_ID:-}")$(remote_assignment STAGING_OPENPATH_SHA "${STAGING_OPENPATH_SHA:-}")$(remote_assignment STAGING_OPENPATH_CONTRACT_SHA256 "${STAGING_OPENPATH_CONTRACT_SHA256:-}")$(remote_assignment STAGING_RELEASE_MANIFEST_B64 "$STAGING_RELEASE_MANIFEST_B64")$(remote_assignment STAGING_RELEASE_BUNDLE_B64 "${STAGING_RELEASE_BUNDLE_B64:-}")$(remote_assignment STAGING_OPENPATH_CONTRACT_B64 "${STAGING_OPENPATH_CONTRACT_B64:-}")$(remote_assignment STAGING_DEPLOY_PAYLOAD_B64 "$STAGING_DEPLOY_PAYLOAD_B64")$(remote_assignment STAGING_CONTAINER_PLATFORM "${STAGING_CONTAINER_PLATFORM:-linux/amd64}")$(remote_assignment STAGING_PUBLIC_URL "$CANONICAL_STAGING_URL")$(remote_assignment STAGING_GHCR_USERNAME "$STAGING_GHCR_USERNAME")$(remote_assignment STAGING_GHCR_TOKEN "$STAGING_GHCR_TOKEN")$(remote_assignment CP_EMAIL_PREFLIGHT_MODE "${CP_EMAIL_PREFLIGHT_MODE:-required}")$runtime_env_assignments
EOF
}

run_staging_local_remote_deploy() {
    log_info "Connecting to staging..."

    validate_staging_local_support_files

    if ! "${SSH_CMD[@]}" "echo connected" > /dev/null 2>&1; then
        log_error "Cannot connect to $STAGING_HOST"
        log_error "Check: STAGING_HOST, STAGING_SSH_KEY, network connectivity"
        exit 1
    fi

    log_success "Connected to staging"
    log_info "Deploying..."

    hydrate_billing_env_from_remote_if_needed
    resolve_staging_email_preflight_policy

    local remote_env_cmd=""
    remote_env_cmd="$(build_staging_remote_env_cmd)"
    "${SSH_CMD[@]}" "${remote_env_cmd}bash -s" < "$STAGING_REMOTE_SCRIPT_PATH"
    record_staging_email_preflight_result

    log_success "Deploy commands executed"
}
