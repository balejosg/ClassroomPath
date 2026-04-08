#!/usr/bin/env bash
# deploy-images.sh - Shared Docker image helpers for deploy-time tools
# shellcheck shell=bash

docker_require_image() {
  local image_ref="$1"
  local label="${2:-image}"
  local pull_log=""

  require_cmd docker

  if docker image inspect "$image_ref" >/dev/null 2>&1; then
    return 0
  fi

  pull_log="$(mktemp)"
  if docker pull "$image_ref" >"$pull_log" 2>&1; then
    rm -f "$pull_log"
    return 0
  fi

  if grep -qi 'no space left on device' "$pull_log"; then
    log_error "Unable to fetch ${label}: $image_ref"
    log_error "Docker pull failed because the host is out of disk space"
  fi

  cat "$pull_log" >&2
  rm -f "$pull_log"
  return 1
}

docker_prepare_required_image() {
  local image_ref="$1"
  local label="${2:-image}"

  if ! docker_require_image "$image_ref" "$label"; then
    log_error "Unable to fetch ${label}: $image_ref"
    return 1
  fi
}

docker_select_image_with_fallback() {
  local __resultvar="$1"
  local preferred_image="$2"
  local fallback_image="$3"
  local label="${4:-image}"
  local selected_image="$preferred_image"

  if ! docker_require_image "$selected_image" "$label"; then
    log_warn "Unable to fetch ${label}: $selected_image"
    log_warn "Falling back to: $fallback_image"
    selected_image="$fallback_image"

    if ! docker_require_image "$selected_image" "$label"; then
      log_error "Unable to fetch ${label}: $selected_image"
      return 1
    fi
  fi

  printf -v "$__resultvar" '%s' "$selected_image"
}
