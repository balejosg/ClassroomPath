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
