#!/usr/bin/env bash
# shellcheck shell=bash

write_deploy_context() {
  release_execution_write_deploy_context "$DEPLOY_CONTEXT_FILE"
}

load_production_release_manifest_impl() {
  RELEASE_MANIFEST_FILE="$(mktemp)"
  local normalized_manifest_file=""
  decode_release_manifest_base64 "$RELEASE_MANIFEST_B64" "$RELEASE_MANIFEST_FILE" >/dev/null || true
  decode_release_manifest_base64 "$RELEASE_MANIFEST_B64_FROM_PAYLOAD" "$RELEASE_MANIFEST_FILE" >/dev/null

  if ! release_manifest_is_canonical_contract "$RELEASE_MANIFEST_FILE"; then
    normalized_manifest_file="$(mktemp)"
    "$(resolve_node_bin)" "$APP_DIR/scripts/lib/release-manifest.mjs" normalize \
      --file "$RELEASE_MANIFEST_FILE" \
      --output-file "$normalized_manifest_file" \
      --sha "$TARGET_SHA"
    mv "$normalized_manifest_file" "$RELEASE_MANIFEST_FILE"
  fi

  load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"
}

classify_production_migration_risk_impl() {
  release_execution_classify_and_gate_production_migrations
}
