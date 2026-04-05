#!/usr/bin/env bash
# deploy-images.sh - Shared Docker image helpers for deploy-time tools
# shellcheck shell=bash

docker_require_image() {
  local image_ref="$1"

  require_cmd docker

  if docker image inspect "$image_ref" >/dev/null 2>&1; then
    return 0
  fi

  docker pull "$image_ref" >/dev/null 2>&1
}

docker_prepare_required_image() {
  local image_ref="$1"
  local label="${2:-image}"

  if ! docker_require_image "$image_ref"; then
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

  if ! docker_require_image "$selected_image"; then
    log_warn "Unable to fetch ${label}: $selected_image"
    log_warn "Falling back to: $fallback_image"
    selected_image="$fallback_image"

    if ! docker_require_image "$selected_image"; then
      log_error "Unable to fetch ${label}: $selected_image"
      return 1
    fi
  fi

  printf -v "$__resultvar" '%s' "$selected_image"
}
