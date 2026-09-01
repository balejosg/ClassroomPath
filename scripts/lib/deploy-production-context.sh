#!/usr/bin/env bash
# shellcheck shell=bash

write_deploy_context() {
  release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
}

load_production_release_manifest_impl() {
  if [ -z "${DEPLOY_RELEASE_ID:-}" ] ||
    [ -z "${RELEASE_MANIFEST_B64_FROM_PAYLOAD:-}" ] ||
    [ -z "${DEPLOY_RELEASE_BUNDLE_B64:-}" ] ||
    [ -z "${DEPLOY_OPENPATH_CONTRACT_B64:-}" ]; then
    log_error "Production deployment is missing the exact Release Bundle v2 payload"
    return 1
  fi

  RELEASE_BUNDLE_FILE="$(mktemp)"
  OPENPATH_CONTRACT_FILE="$(mktemp)"
  RELEASE_BUNDLE_RUNTIME_FILE="$(mktemp)"
  RELEASE_MANIFEST_FILE="$(mktemp)"
  decode_release_manifest_base64 \
    "$RELEASE_MANIFEST_B64_FROM_PAYLOAD" \
    "$RELEASE_MANIFEST_FILE" >/dev/null || return 1
  release_manifest_validate_contract "$RELEASE_MANIFEST_FILE" "$TARGET_SHA" || return 1

  local manifest_run_id=""
  local manifest_verifier_image=""
  manifest_run_id="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" run_id)" || return 1
  if [ "$manifest_run_id" != "$DEPLOY_RC_RUN_ID" ]; then
    log_error "Production release manifest run_id does not match the exact release-candidate run"
    return 1
  fi
  manifest_verifier_image="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" verifier_image)" || return 1
  CLASSROOMPATH_VERIFIER_IMAGE="$manifest_verifier_image"

  printf '%s' "$DEPLOY_RELEASE_BUNDLE_B64" | base64 --decode > "$RELEASE_BUNDLE_FILE"
  printf '%s' "$DEPLOY_OPENPATH_CONTRACT_B64" | base64 --decode > "$OPENPATH_CONTRACT_FILE"

  verify_release_bundle_in_verifier_image || return 1

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
  if [ "${CLASSROOMPATH_VERIFIER_IMAGE:-}" != "$manifest_verifier_image" ]; then
    log_error "Verified Release Bundle verifier image does not match the exact release manifest"
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

verify_release_bundle_in_verifier_image() {
  local output_dir=""
  local verified_runtime_path=""
  local verifier_image="${CLASSROOMPATH_VERIFIER_IMAGE:-}"

  if [ -z "$verifier_image" ]; then
    log_error "Production deployment is missing the immutable Release Bundle verifier image"
    return 1
  fi

  if ! docker run --rm --entrypoint node "$verifier_image" \
    /app/scripts/release-verifier-package.mjs check >/dev/null; then
    FAILURE_POINT="verifier-command-missing"
    FAILURE_CATEGORY="verifier-packaging"
    FAILURE_MESSAGE="immutable verifier package contract is incomplete"
    export FAILURE_POINT FAILURE_CATEGORY FAILURE_MESSAGE
    log_error "Immutable Release Bundle verifier package contract failed"
    return 1
  fi

  output_dir="$(mktemp -d)"
  verified_runtime_path="$output_dir/runtime.env"
  if ! chmod 644 "$RELEASE_BUNDLE_FILE" "$OPENPATH_CONTRACT_FILE" ||
    ! chmod 777 "$output_dir"; then
    rm -rf "$output_dir"
    log_error "Unable to prepare immutable Release Bundle files for verifier execution"
    return 1
  fi

  if ! docker run --rm \
    --entrypoint node \
    -v "$RELEASE_BUNDLE_FILE:/tmp/classroompath-release-bundle.json:ro" \
    -v "$OPENPATH_CONTRACT_FILE:/tmp/openpath-promotion-contract.json:ro" \
    -v "$output_dir:/tmp/release-bundle-output:rw" \
    "$verifier_image" \
    "/app/scripts/release-bundle.mjs" verify \
    --bundle-file /tmp/classroompath-release-bundle.json \
    --contract-file /tmp/openpath-promotion-contract.json \
    --release-id "$DEPLOY_RELEASE_ID" \
    --classroompath-sha "$TARGET_SHA" \
    --output-env /tmp/release-bundle-output/runtime.env >/dev/null; then
    rm -rf "$output_dir"
    log_error "Immutable Release Bundle verification failed inside the verifier image"
    return 1
  fi

  if [ ! -s "$verified_runtime_path" ]; then
    rm -rf "$output_dir"
    log_error "Verifier image did not emit the Release Bundle runtime projection"
    return 1
  fi

  if ! cp "$verified_runtime_path" "$RELEASE_BUNDLE_RUNTIME_FILE"; then
    rm -rf "$output_dir"
    log_error "Unable to retain the verified Release Bundle runtime projection"
    return 1
  fi

  rm -rf "$output_dir"
}

classify_production_migration_risk_impl() {
  release_execution_classify_and_gate_production_migrations
}
