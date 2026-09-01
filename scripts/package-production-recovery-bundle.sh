#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_PATH="${1:?usage: $0 OUTPUT_TGZ}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

RECOVERY_FILES=(
  common.sh
  remote-bootstrap.sh
  remote-deploy-scaffold.sh
  remote-helper-contracts.sh
  release-state.sh
  release-runtime.sh
  deployment-state.sh
  production-host-contract.sh
  deployment-transaction.sh
  rollback-executor.sh
  rollback-readiness.sh
  deploy-container-platform.sh
)

mkdir -p "$TMP_DIR/lib" "$(dirname "$OUTPUT_PATH")"
install -m 700 "$SCRIPT_DIR/lib/production-recovery-executor.sh" \
  "$TMP_DIR/production-recovery-executor.sh"

for file_name in "${RECOVERY_FILES[@]}"; do
  source_path="$SCRIPT_DIR/lib/$file_name"
  if [ ! -f "$source_path" ]; then
    printf 'Recovery bundle source file not found: %s\n' "$source_path" >&2
    exit 1
  fi
  install -m 600 "$source_path" "$TMP_DIR/lib/$file_name"
done

tar -czf "$OUTPUT_PATH" -C "$TMP_DIR" production-recovery-executor.sh lib
printf '%s\n' "$OUTPUT_PATH"
