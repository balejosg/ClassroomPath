#!/bin/bash

prepare_staging_local_release_context() {
    log_info "Checking git state..."

    cd "$SCRIPT_DIR/.."

    if ! git diff --quiet || ! git diff --cached --quiet; then
        log_warn "Uncommitted changes detected"
        log_warn "Staging will deploy origin/main, not local changes"

        if [ "$DEPLOY_ASSUME_YES" = "1" ]; then
            log_warn "DEPLOY_ASSUME_YES=1; continuing without prompt"
        elif confirm_with_timeout "Continue anyway?" 10; then
            :
        else
            if is_tty_stdin; then
                log_error "Aborted. Commit and push your changes first."
            else
                log_error "Aborted (non-interactive). Set DEPLOY_ASSUME_YES=1 to override."
            fi
            exit 1
        fi
    fi

    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" != "main" ]; then
        log_warn "Not on main branch (on: $CURRENT_BRANCH)"
        log_warn "Staging deploys origin/main regardless"
    fi

    LOCAL_SHA=$(git rev-parse HEAD)

    REMOTE_SHA="unknown"
    if git remote get-url origin >/dev/null 2>&1; then
        git fetch origin main --quiet || true
        REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "unknown")
    fi

    if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
        log_warn "Local HEAD differs from origin/main"
        log_info "Local:  $LOCAL_SHA"
        log_info "Remote: $REMOTE_SHA"
    fi

    STAGING_IMAGE_SOURCE="$STAGING_IMAGE_MODE"
    STAGING_DEPLOYMENT_MODE=""
    STAGING_USE_RELEASE_CANDIDATE=0
    STAGING_RELEASE_SHA=""
    STAGING_RELEASE_RUN_ID=""
    STAGING_RELEASE_REPOSITORY=""
    STAGING_RELEASE_MANIFEST_FILE=""
    STAGING_RELEASE_MANIFEST_B64=""
    STAGING_RELEASE_PLAN_ENV_FILE=""
    STAGING_DEPLOY_PAYLOAD_ENV_FILE=""
    STAGING_DEPLOY_PAYLOAD_B64=""
    STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE="0"
    VERIFICATION_STATE_FILE=""

    if [ "$STAGING_IMAGE_MODE" = "release-candidate" ] && [ "$REMOTE_SHA" != "unknown" ]; then
        require_cmd gh
        STAGING_RELEASE_MANIFEST_FILE="$(mktemp)"
        node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest \
            --sha "$REMOTE_SHA" \
            --timeout-seconds "$STAGING_RELEASE_WAIT_TIMEOUT_SECONDS" \
            --interval-seconds "$STAGING_RELEASE_POLL_SECONDS" \
            --output-file "$STAGING_RELEASE_MANIFEST_FILE" >/dev/null
    elif [ "$STAGING_IMAGE_MODE" = "release-candidate" ]; then
        log_error "STAGING_IMAGE_MODE=release-candidate requires origin/main to be reachable"
        exit 1
    fi

    STAGING_RELEASE_PLAN_ENV_FILE="$(mktemp)"
    PLAN_ARGS=(
        --image-mode "$STAGING_IMAGE_MODE"
        --remote-sha "$REMOTE_SHA"
    )

    if [ -n "$STAGING_RELEASE_MANIFEST_FILE" ]; then
        PLAN_ARGS+=(--manifest-file "$STAGING_RELEASE_MANIFEST_FILE")
    fi

    node "$SCRIPT_DIR/lib/release-plan.mjs" render-staging-env "${PLAN_ARGS[@]}" > "$STAGING_RELEASE_PLAN_ENV_FILE"

    set -a
    . "$STAGING_RELEASE_PLAN_ENV_FILE"
    set +a

    STAGING_DEPLOY_PAYLOAD_ENV_FILE="$(mktemp)"
    node "$SCRIPT_DIR/lib/deploy-payload.mjs" render-env \
        --target-environment staging \
        --deploy-ref "refs/heads/main" \
        --deploy-sha "$REMOTE_SHA" \
        --image-source "$STAGING_IMAGE_SOURCE" \
        --deployment-mode "$STAGING_DEPLOYMENT_MODE" \
        --manifest-base64 "$STAGING_RELEASE_MANIFEST_B64" > "$STAGING_DEPLOY_PAYLOAD_ENV_FILE"

    set -a
    . "$STAGING_DEPLOY_PAYLOAD_ENV_FILE"
    set +a
    STAGING_DEPLOY_PAYLOAD_B64="${DEPLOY_PAYLOAD_B64:-}"

    if [ "$STAGING_RUN_RELEASE_GATE" = "1" ] && [ "${STAGING_DEPLOYMENT_MODE:-debug}" != "promotion-eligible" ]; then
        log_error "STAGING_DEPLOYMENT_MODE=${STAGING_DEPLOYMENT_MODE:-unset} cannot produce promotion evidence"
        log_error "Set STAGING_RUN_RELEASE_GATE=0 for debug or recovery deploys that only need runtime smoke coverage"
        exit 2
    fi

    if [ "$STAGING_USE_RELEASE_CANDIDATE" = "1" ]; then
        log_info "Staging will deploy release candidate images for $STAGING_RELEASE_SHA"
        if [ -n "$STAGING_RELEASE_RUN_ID" ]; then
            log_info "Release candidate workflow run: $STAGING_RELEASE_RUN_ID"
        fi
    fi

    log_success "Git state checked"
}
