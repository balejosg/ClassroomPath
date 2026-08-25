#!/usr/bin/env bash
# shellcheck shell=bash

DEPLOY_DISK_THRESHOLD_PERCENT="${DEPLOY_DISK_THRESHOLD_PERCENT:-80}"

current_disk_usage_percent() {
  local target_path="${1:-/}"

  df "$target_path" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

disk_usage_exceeds_threshold() {
  local disk_usage="${1:-0}"
  local threshold="${2:-$DEPLOY_DISK_THRESHOLD_PERCENT}"

  [ "$disk_usage" -gt "$threshold" ]
}

cleanup_docker_disk_if_needed() {
  local host_label="${1:-Host}"
  local disk_usage=""
  local new_usage=""

  disk_usage="$(current_disk_usage_percent /)"
  log_info "${host_label} disk usage: ${disk_usage}%"

  if disk_usage_exceeds_threshold "$disk_usage"; then
    log_warn "${host_label} disk usage above ${DEPLOY_DISK_THRESHOLD_PERCENT}%, running Docker cleanup..."
    docker system prune -af --volumes 2>/dev/null || true
    docker builder prune -af 2>/dev/null || true
    new_usage="$(current_disk_usage_percent /)"
    log_info "${host_label} disk usage after cleanup: ${new_usage}%"
  fi
}

provision_windows_offline_installer_template() {
  local app_dir="${1:-${APP_DIR:-}}"
  local provisioner=""
  local pinned_version="${CP_OFFLINE_INSTALLER_TEMPLATE_VERSION:-}"
  local pinned_commit="${CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT:-}"
  local pinned_release_tag="${CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG:-}"
  local pinned_sha256="${CP_OFFLINE_INSTALLER_TEMPLATE_SHA256:-}"

  if [ -z "$app_dir" ]; then
    log_error "ClassroomPath app directory is required for Windows installer template provisioning"
    return 1
  fi

  provisioner="$app_dir/scripts/provision-windows-offline-installer-template.mjs"
  if [ ! -f "$provisioner" ]; then
    log_error "Windows installer template provisioner not found: $provisioner"
    return 1
  fi

  configure_node_path
  load_env_file "$app_dir/config/.env" || true

  # Release metadata supplied by the deploy payload is authoritative. Keep it
  # across loading the host's shared .env, which may still contain an older pin.
  if [ -n "$pinned_version" ]; then export CP_OFFLINE_INSTALLER_TEMPLATE_VERSION="$pinned_version"; fi
  if [ -n "$pinned_commit" ]; then export CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT="$pinned_commit"; fi
  if [ -n "$pinned_release_tag" ]; then export CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG="$pinned_release_tag"; fi
  if [ -n "$pinned_sha256" ]; then export CP_OFFLINE_INSTALLER_TEMPLATE_SHA256="$pinned_sha256"; fi

  log_info "Provisioning pinned Windows offline installer template..."
  (
    cd "$app_dir/docker" || exit 1
    "$NODE_BIN" "$provisioner"
  )
  log_info "Verifying provisioned Windows offline installer template..."
  (
    cd "$app_dir/docker" || exit 1
    "$NODE_BIN" "$provisioner" --verify-only
  )
}
