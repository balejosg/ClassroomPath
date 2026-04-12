#!/usr/bin/env bash
# shellcheck shell=bash

DEPLOYMENT_STATE_HELPER_CONTRACT_VERSION=1

deployment_state_init_paths() {
  local state_dir="$1"

  DEPLOYMENT_STATE_DIR="$state_dir"
  DEPLOYMENT_STATE_CURRENT_FILE="$state_dir/current-images.env"
  DEPLOYMENT_STATE_PREVIOUS_FILE="$state_dir/previous-images.env"
  DEPLOYMENT_STATE_CONTEXT_FILE="$state_dir/deploy-context.env"
}

deployment_state_capture_previous_release() {
  if [ -f "$DEPLOYMENT_STATE_CURRENT_FILE" ]; then
    cp "$DEPLOYMENT_STATE_CURRENT_FILE" "$DEPLOYMENT_STATE_PREVIOUS_FILE"
    PREVIOUS_APP_SHA="$(awk -F= '/^APP_SHA=/{print $2}' "$DEPLOYMENT_STATE_CURRENT_FILE" | head -1)"
  else
    PREVIOUS_APP_SHA="${PREVIOUS_APP_SHA:-}"
  fi
}

deployment_state_load_previous_release() {
  if [ ! -f "$DEPLOYMENT_STATE_PREVIOUS_FILE" ]; then
    log_error "No previous release metadata available: $DEPLOYMENT_STATE_PREVIOUS_FILE"
    return 1
  fi

  load_release_state_env "$DEPLOYMENT_STATE_PREVIOUS_FILE"
}

deployment_state_load_context() {
  if [ -f "$DEPLOYMENT_STATE_CONTEXT_FILE" ]; then
    load_release_state_env "$DEPLOYMENT_STATE_CONTEXT_FILE"
  fi
}

deployment_state_activate_previous_release() {
  if [ ! -f "$DEPLOYMENT_STATE_PREVIOUS_FILE" ]; then
    log_error "No previous release metadata available: $DEPLOYMENT_STATE_PREVIOUS_FILE"
    return 1
  fi

  cp "$DEPLOYMENT_STATE_PREVIOUS_FILE" "$DEPLOYMENT_STATE_CURRENT_FILE"
}
