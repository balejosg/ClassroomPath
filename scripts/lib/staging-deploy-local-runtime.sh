#!/bin/bash

has_complete_billing_env() {
    local mode="${CP_BILLING_MODE:-}"

    if [ -z "$mode" ] || [ -z "${CP_PLATFORM_ADMIN_EMAILS:-}" ]; then
        return 1
    fi

    case "$mode" in
        manual_only)
            return 0
            ;;
        stripe)
            local stripe_name=""
            for stripe_name in \
                STRIPE_SECRET_KEY \
                STRIPE_WEBHOOK_SECRET \
                STRIPE_ANNUAL_PRICE_1_10 \
                STRIPE_ANNUAL_PRICE_11_25 \
                STRIPE_ANNUAL_PRICE_26_50 \
                STRIPE_ANNUAL_PRICE_51_100 \
                STRIPE_ONBOARDING_PRICE_1_25 \
                STRIPE_ONBOARDING_PRICE_26_100 \
                STRIPE_PILOT_PRICE; do
                if [ -z "${!stripe_name:-}" ]; then
                    return 1
                fi
            done
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

list_missing_billing_env() {
    local mode="${CP_BILLING_MODE:-}"
    local missing=()
    local name=""

    if [ -z "$mode" ]; then
        missing+=("CP_BILLING_MODE")
    fi

    if [ -z "${CP_PLATFORM_ADMIN_EMAILS:-}" ]; then
        missing+=("CP_PLATFORM_ADMIN_EMAILS")
    fi

    if [ "$mode" = "stripe" ]; then
        for name in \
            STRIPE_SECRET_KEY \
            STRIPE_WEBHOOK_SECRET \
            STRIPE_ANNUAL_PRICE_1_10 \
            STRIPE_ANNUAL_PRICE_11_25 \
            STRIPE_ANNUAL_PRICE_26_50 \
            STRIPE_ANNUAL_PRICE_51_100 \
            STRIPE_ONBOARDING_PRICE_1_25 \
            STRIPE_ONBOARDING_PRICE_26_100 \
            STRIPE_PILOT_PRICE; do
            if [ -z "${!name:-}" ]; then
                missing+=("$name")
            fi
        done
    fi

    printf '%s\n' "${missing[*]}"
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

    grep_pattern='^(CP_BILLING_MODE|CP_PLATFORM_ADMIN_EMAILS|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_ANNUAL_PRICE_1_10|STRIPE_ANNUAL_PRICE_11_25|STRIPE_ANNUAL_PRICE_26_50|STRIPE_ANNUAL_PRICE_51_100|STRIPE_ONBOARDING_PRICE_1_25|STRIPE_ONBOARDING_PRICE_26_100|STRIPE_PILOT_PRICE)='

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

remote_assignment() {
    local key="$1"
    local value="$2"
    printf '%s=%q ' "$key" "$value"
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
    cat <<EOF
$(remote_assignment STAGING_IMAGE_MODE "$STAGING_IMAGE_MODE")$(remote_assignment STAGING_USE_RELEASE_CANDIDATE "$STAGING_USE_RELEASE_CANDIDATE")$(remote_assignment STAGING_RELEASE_SHA "$STAGING_RELEASE_SHA")$(remote_assignment STAGING_RELEASE_RUN_ID "$STAGING_RELEASE_RUN_ID")$(remote_assignment STAGING_RELEASE_REPOSITORY "$STAGING_RELEASE_REPOSITORY")$(remote_assignment STAGING_RELEASE_MANIFEST_B64 "$STAGING_RELEASE_MANIFEST_B64")$(remote_assignment STAGING_DEPLOY_PAYLOAD_B64 "$STAGING_DEPLOY_PAYLOAD_B64")$(remote_assignment STAGING_GHCR_USERNAME "$STAGING_GHCR_USERNAME")$(remote_assignment STAGING_GHCR_TOKEN "$STAGING_GHCR_TOKEN")$(remote_assignment CP_BILLING_MODE "${CP_BILLING_MODE:-}")$(remote_assignment CP_PLATFORM_ADMIN_EMAILS "${CP_PLATFORM_ADMIN_EMAILS:-}")$(remote_assignment STRIPE_SECRET_KEY "${STRIPE_SECRET_KEY:-}")$(remote_assignment STRIPE_WEBHOOK_SECRET "${STRIPE_WEBHOOK_SECRET:-}")$(remote_assignment STRIPE_ANNUAL_PRICE_1_10 "${STRIPE_ANNUAL_PRICE_1_10:-}")$(remote_assignment STRIPE_ANNUAL_PRICE_11_25 "${STRIPE_ANNUAL_PRICE_11_25:-}")$(remote_assignment STRIPE_ANNUAL_PRICE_26_50 "${STRIPE_ANNUAL_PRICE_26_50:-}")$(remote_assignment STRIPE_ANNUAL_PRICE_51_100 "${STRIPE_ANNUAL_PRICE_51_100:-}")$(remote_assignment STRIPE_ONBOARDING_PRICE_1_25 "${STRIPE_ONBOARDING_PRICE_1_25:-}")$(remote_assignment STRIPE_ONBOARDING_PRICE_26_100 "${STRIPE_ONBOARDING_PRICE_26_100:-}")$(remote_assignment STRIPE_PILOT_PRICE "${STRIPE_PILOT_PRICE:-}")
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

    local remote_env_cmd=""
    remote_env_cmd="$(build_staging_remote_env_cmd)"
    "${SSH_CMD[@]}" "${remote_env_cmd}bash -s" < "$STAGING_REMOTE_SCRIPT_PATH"

    log_success "Deploy commands executed"
}
