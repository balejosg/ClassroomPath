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

docker_run_node_tool_with_verifier_fallback() {
  local log_prefix="$1"
  local app_dir="$2"
  local env_file="$3"
  local preferred_node_image="$4"
  local fallback_node_image="$5"
  local tool_entrypoint="$6"
  local tool_description="$7"
  local install_command="${8:-npm ci --silent -w @classroompath/api}"
  local selected_node_image="$preferred_node_image"

  if [ -n "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ]; then
    log_info "[$log_prefix] Using prebuilt verifier image: $CLASSROOMPATH_VERIFIER_IMAGE"

    if docker_prepare_required_image "$CLASSROOMPATH_VERIFIER_IMAGE" "verifier image"; then
      docker run --rm \
        --env-file "$env_file" \
        "$CLASSROOMPATH_VERIFIER_IMAGE" \
        node --import tsx "$tool_entrypoint"
      return 0
    fi

    log_warn "Unable to fetch verifier image: $CLASSROOMPATH_VERIFIER_IMAGE"
    log_warn "Falling back to generic node $tool_description image"
  fi

  docker_select_image_with_fallback \
    selected_node_image \
    "$selected_node_image" \
    "$fallback_node_image" \
    "node image" || return 1

  log_info "[$log_prefix] - ClassroomPath $tool_description..."

  docker run --rm \
    -v "$app_dir:/app" \
    -w /app \
    --env-file "$env_file" \
    "$selected_node_image" \
    sh -c "$install_command && node --import tsx \"\$1\"" sh "$tool_entrypoint"
}
