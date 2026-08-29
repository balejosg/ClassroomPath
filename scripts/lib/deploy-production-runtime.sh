#!/usr/bin/env bash
# shellcheck shell=bash

plan_production_runtime_deploy_impl() {
  PRODUCTION_DEPLOY_PLAN="release-candidate"
}

ensure_production_release_candidate_runtime_env() {
  local release_manifest_b64=""

  if [ "${PRODUCTION_DEPLOY_PLAN:-}" != "release-candidate" ]; then
    return 0
  fi

  release_manifest_b64="${RELEASE_MANIFEST_B64_FROM_PAYLOAD:-${RELEASE_MANIFEST_B64:-}}"
  if [ -n "$release_manifest_b64" ]; then
    RELEASE_MANIFEST_FILE="$(mktemp)"
    decode_release_manifest_base64 "$release_manifest_b64" "$RELEASE_MANIFEST_FILE" >/dev/null
  fi

  # A release manifest is authoritative even when a legacy host already has a
  # complete, but stale, runtime pin in its environment.
  if [ -n "${RELEASE_MANIFEST_FILE:-}" ] && [ -f "$RELEASE_MANIFEST_FILE" ]; then
    load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "${TARGET_SHA:-}"
    TARGET_SHA="${RELEASE_MANIFEST_APP_SHA:-${TARGET_SHA:-}}"
  fi

  if [ -z "${OPENPATH_FIREFOX_ASSETS_IMAGE:-}" ] || [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ]; then
    if [ -n "${RELEASE_MANIFEST_FILE:-}" ] && [ -f "$RELEASE_MANIFEST_FILE" ]; then
      export OPENPATH_VERSION
      OPENPATH_VERSION="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" openpath_version)"
      export OPENPATH_LINUX_AGENT_VERSION
      OPENPATH_LINUX_AGENT_VERSION="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" linux_agent_version)"
      export OPENPATH_LINUX_AGENT_APT_SUITE
      OPENPATH_LINUX_AGENT_APT_SUITE="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" linux_agent_apt_suite)"
    fi
  fi

  if [ -z "${OPENPATH_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_VERSION:-}" ] || [ -z "${OPENPATH_LINUX_AGENT_APT_SUITE:-}" ]; then
    log_error "Release candidate manifest did not export OpenPath runtime versions"
    return 1
  fi

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
  docker compose pull gateway api windows-offline-installer-provision spa

  log_info "Stopping existing containers..."
  docker compose down --remove-orphans || true
  docker rm -f classroompath-api classroompath-gateway classroompath-spa 2>/dev/null || true
  docker rm -f classroompath-production-api-1 classroompath-production-gateway-1 classroompath-production-spa-1 2>/dev/null || true

  log_info "Starting containers from immutable images..."
  docker compose up -d --force-recreate --no-build

  if [ "${PRODUCTION_DEPLOY_PLAN:-}" != "release-candidate" ]; then
    die "Unknown production deploy plan: ${PRODUCTION_DEPLOY_PLAN:-unset}" 1
  fi

  write_release_runtime_state \
    "$STATE_DIR/current-images.env" \
    "$TARGET_SHA" \
    "release-candidate" \
    "$CLASSROOMPATH_GATEWAY_IMAGE" \
    "$CLASSROOMPATH_MIGRATIONS_IMAGE" \
    "$OPENPATH_FIREFOX_ASSETS_IMAGE" \
    "$OPENPATH_API_IMAGE" \
    "${OPENPATH_VERSION:-}" \
    "${OPENPATH_LINUX_AGENT_VERSION:-}" \
    "$CLASSROOMPATH_SPA_IMAGE" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG" \
    "$OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256"
}

start_production_runtime_impl() {
  plan_production_runtime_deploy_impl
  apply_production_runtime_deploy_impl
}

wait_for_production_runtime_readiness_impl() {
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
  log_info "Checking full application readiness..."

  local ready_check=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ready_check=$(curl -sf http://localhost:3001/cp/ready 2>/dev/null || echo '{"ready":false}')
    if echo "$ready_check" | grep -q '"ready":true'; then
      log_success "Application readiness OK"
      release_execution_mark_stage completed
      log_success "Deployment successful"
      docker logs classroompath-gateway --tail 5
      return 0
    fi

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
