#!/usr/bin/env bash
# shellcheck shell=bash

plan_production_runtime_deploy_impl() {
  PRODUCTION_DEPLOY_PLAN="release-candidate"
}

ensure_production_release_candidate_runtime_env() {
  if [ "${PRODUCTION_DEPLOY_PLAN:-}" != "release-candidate" ]; then
    return 0
  fi

  if [ -z "${RELEASE_ID:-}" ] ||
    [ -z "${RC_RUN_ID:-}" ] ||
    [ -z "${OPENPATH_SHA:-}" ] ||
    [ -z "${OPENPATH_CONTRACT_SHA256:-}" ] ||
    [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] ||
    [ -z "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ] ||
    [ -z "${OPENPATH_VERSION:-}" ] ||
    [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] ||
    [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}" ] ||
    [ -z "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}" ]; then
    log_error "Verified Release Bundle v2 did not export the complete immutable runtime identity"
    return 1
  fi

  require_openpath_linux_agent_runtime_pin || return 1
  require_windows_offline_installer_runtime_pin || return 1

  return 0
}

apply_production_runtime_deploy_impl() {
  cd "$APP_DIR/docker"
  export COMPOSE_PROJECT_NAME=classroompath-production
  configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/amd64}" || return 1
  verify_deploy_container_platform || return 1
  ensure_production_release_candidate_runtime_env || return 1
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_VERSION "${OPENPATH_VERSION:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256 "${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:-}"
  upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release
  export CP_REQUIRE_PUSH_NOTIFICATIONS=1
  bash "$APP_DIR/scripts/sync-billing-env.sh" "$APP_DIR/config/.env"
  bash "$APP_DIR/scripts/validate-runtime-config-docker.sh" --app-dir "$APP_DIR" --env-file "$APP_DIR/config/.env"

  if declare -f cleanup_production_disk_if_needed >/dev/null 2>&1; then
    cleanup_production_disk_if_needed
  fi

  login_production_registry

  log_info "Preparing OpenPath Firefox release assets..."
  prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "${TARGET_SHA:-current}"

  log_info "Pulling immutable release images..."
  FAILURE_POINT="docker-pull"
  FAILURE_CATEGORY="image-pull"
  FAILURE_MESSAGE="immutable production image pull failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  docker compose pull gateway api windows-offline-installer-provision spa

  # Persist the candidate bundle and runtime projection before stopping the
  # known-good containers. This makes every post-switch state recoverable and
  # moves verifier/state failures to the pre-mutation side of the boundary.
  FAILURE_POINT="state-persistence"
  FAILURE_CATEGORY="state-write"
  FAILURE_MESSAGE="candidate release state persistence failed before switch"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  write_release_runtime_state \
    "${DEPLOYMENT_STATE_PENDING_FILE:-$STATE_DIR/pending-images.env}" \
    "$TARGET_SHA" \
    "release-candidate" \
    "$CLASSROOMPATH_GATEWAY_IMAGE" \
    "$CLASSROOMPATH_MIGRATIONS_IMAGE" \
    "$OPENPATH_FIREFOX_ASSETS_IMAGE" \
    "$OPENPATH_API_IMAGE" \
    "${OPENPATH_VERSION:-}" \
    "${OPENPATH_LINUX_AGENT_VERSION:-}" \
    "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" \
    "$CLASSROOMPATH_SPA_IMAGE" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256" \
    "$RELEASE_ID" \
    "$OPENPATH_SHA" \
    "$OPENPATH_CONTRACT_SHA256" \
    "$CLASSROOMPATH_VERIFIER_IMAGE" \
    "$RC_RUN_ID"

  deployment_state_persist_v2_release \
    "$RELEASE_BUNDLE_FILE" \
    "$OPENPATH_CONTRACT_FILE" \
    "$RELEASE_ID" \
    "$RC_RUN_ID"

  FAILURE_POINT="container-stop"
  FAILURE_CATEGORY="container-switch"
  FAILURE_MESSAGE="stopping the previous production containers failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  log_info "Stopping existing containers..."
  docker compose down --remove-orphans
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  docker rm -f classroompath-production-api-1 classroompath-production-gateway-1 classroompath-production-spa-1 2>/dev/null || true

  FAILURE_POINT="container-start"
  FAILURE_CATEGORY="container-switch"
  FAILURE_MESSAGE="starting the candidate production containers failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  log_info "Starting containers from immutable images..."
  docker compose up -d --force-recreate --no-build

  if declare -f deployment_transaction_transition >/dev/null 2>&1; then
    deployment_transaction_transition "$DEPLOYMENT_PHASE_ACTIVATED_UNVERIFIED" "SWITCH" || return 1
  fi

  if [ "${PRODUCTION_DEPLOY_PLAN:-}" != "release-candidate" ]; then
    die "Unknown production deploy plan: ${PRODUCTION_DEPLOY_PLAN:-unset}" 1
  fi

}

start_production_runtime_impl() {
  plan_production_runtime_deploy_impl
  apply_production_runtime_deploy_impl
}

production_readiness_failure_point() {
  local response="${1:-}"
  local compact_response=""

  compact_response="$(printf '%s' "$response" | tr -d '[:space:]')"
  case "$compact_response" in
    '{"ready":false}'|'{"ready":false,'*'}')
      printf '%s\n' 'ready-false'
      ;;
    *)
      printf '%s\n' 'malformed-ready'
      ;;
  esac
}

wait_for_production_runtime_readiness_impl() {
  FAILURE_POINT="health"
  FAILURE_CATEGORY="health"
  FAILURE_MESSAGE="candidate gateway health check failed"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  log_info "Waiting for services to be healthy..."
  timeout 60 bash -c 'until docker compose ps | grep -q "healthy"; do sleep 2; done' || {
    log_warn "Timeout waiting for container health checks"
    docker compose ps
  }

  for i in 1 2 3 4 5; do
    if curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
      log_success "Gateway health check passed"
      break
    fi
    log_warn "Health check attempt $i failed, retrying..."
    sleep 5
  done

  if ! curl -sf http://localhost:3001/cp/health > /dev/null 2>&1; then
    log_error "Gateway deployment failed. Check logs:"
    docker logs classroompath-gateway --tail 30
    exit 1
  fi

  release_execution_mark_stage readiness
  FAILURE_POINT="ready-false"
  FAILURE_CATEGORY="readiness"
  FAILURE_MESSAGE="candidate readiness did not satisfy semantic ready=true"
  export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
  log_info "Checking full application readiness..."

  local ready_check=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ready_check=$(curl -sf http://localhost:3001/cp/ready 2>/dev/null || echo '{"ready":false}')
    if rollback_readiness_json_is_ready "$ready_check"; then
      log_success "Application readiness OK"
      if declare -f deployment_transaction_transition >/dev/null 2>&1; then
        deployment_transaction_transition "$DEPLOYMENT_PHASE_VERIFIED" "VERIFY" || return 1
      fi
      deployment_state_activate_v2_release "$RELEASE_ID"
      deployment_state_publish_pending_release
      if declare -f deployment_transaction_transition >/dev/null 2>&1; then
        deployment_transaction_transition "$DEPLOYMENT_PHASE_COMMITTED" "COMMIT" || return 1
      fi
      release_execution_mark_stage completed
      log_success "Deployment successful"
      docker logs classroompath-gateway --tail 5 || true
      return 0
    fi

    FAILURE_POINT="$(production_readiness_failure_point "$ready_check")"
    if [ "$FAILURE_POINT" = "malformed-ready" ]; then
      FAILURE_CATEGORY="readiness-contract"
      FAILURE_MESSAGE="candidate readiness response was not valid JSON with ready=true"
    else
      FAILURE_CATEGORY="readiness"
      FAILURE_MESSAGE="candidate readiness did not satisfy semantic ready=true"
    fi
    export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE

    if [ "$i" -lt 12 ]; then
      log_warn "Application not ready (attempt $i/12), waiting 5s..."
      sleep 5
    else
      log_error "APPLICATION READINESS FAILED after 12 attempts"
      log_error "Readiness response: $ready_check"
      log_error "Code rollback can be attempted automatically; DB migrated=$DB_MIGRATED backup=${PRODUCTION_BACKUP_REFERENCE:-none}"
      log_error "Debug: docker logs classroompath-gateway --tail 50"
      log_error "Debug: docker logs classroompath-api --tail 50"
      exit 1
    fi
  done
}
