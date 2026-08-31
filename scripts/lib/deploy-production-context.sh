#!/usr/bin/env bash
# shellcheck shell=bash

write_deploy_context() {
  release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
}

load_production_release_manifest_impl() {
  if [ -z "${DEPLOY_RELEASE_ID:-}" ] ||
    [ -z "${DEPLOY_RELEASE_BUNDLE_B64:-}" ] ||
    [ -z "${DEPLOY_OPENPATH_CONTRACT_B64:-}" ]; then
    log_error "Production deployment is missing the exact Release Bundle v2 payload"
    return 1
  fi

  RELEASE_BUNDLE_FILE="$(mktemp)"
  OPENPATH_CONTRACT_FILE="$(mktemp)"
  RELEASE_BUNDLE_RUNTIME_FILE="$(mktemp)"
  printf '%s' "$DEPLOY_RELEASE_BUNDLE_B64" | base64 --decode > "$RELEASE_BUNDLE_FILE"
  printf '%s' "$DEPLOY_OPENPATH_CONTRACT_B64" | base64 --decode > "$OPENPATH_CONTRACT_FILE"

  "$(resolve_node_bin)" "$APP_DIR/scripts/release-bundle.mjs" verify \
    --bundle-file "$RELEASE_BUNDLE_FILE" \
    --contract-file "$OPENPATH_CONTRACT_FILE" \
    --release-id "$DEPLOY_RELEASE_ID" \
    --classroompath-sha "$TARGET_SHA" \
    --output-env "$RELEASE_BUNDLE_RUNTIME_FILE" >/dev/null

  set -a
  # shellcheck disable=SC1090 # generated projection from verified immutable bytes
  . "$RELEASE_BUNDLE_RUNTIME_FILE"
  set +a

  if [ "${RELEASE_ID:-}" != "$DEPLOY_RELEASE_ID" ]; then
    log_error "Verified Release Bundle releaseId does not match the production deploy intent"
    return 1
  fi
  if [ "${APP_SHA:-}" != "$TARGET_SHA" ]; then
    log_error "Verified Release Bundle ClassroomPath SHA does not match the production target"
    return 1
  fi

  local gitlink_openpath_sha=""
  gitlink_openpath_sha="$(git -C "$APP_DIR/upstream/openpath" rev-parse HEAD)"
  if [ "$gitlink_openpath_sha" != "${OPENPATH_SHA:-}" ]; then
    log_error "Verified Release Bundle OpenPath SHA does not match the checked-out gitlink"
    return 1
  fi

  RC_RUN_ID="$DEPLOY_RC_RUN_ID"
  export RELEASE_ID APP_SHA OPENPATH_SHA OPENPATH_CONTRACT_SHA256 RC_RUN_ID
}

classify_production_migration_risk_impl() {
  release_execution_classify_and_gate_production_migrations
}
