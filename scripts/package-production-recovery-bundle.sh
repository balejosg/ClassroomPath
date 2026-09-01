#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_PATH="${1:?usage: $0 OUTPUT_TGZ}"
TMP_DIR="$(mktemp -d)"
PRODUCTION_RECOVERY_SHA="${PRODUCTION_RECOVERY_SHA:-}"

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
  production-recovery-contract.sh
)

SOURCE_SHA="$(git -C "$SOURCE_ROOT" rev-parse --verify HEAD^{commit} 2>/dev/null || true)"
if [[ ! "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Recovery source must resolve to a full Git SHA: %s\n' "$SOURCE_ROOT" >&2
  exit 1
fi
if [[ ! "$PRODUCTION_RECOVERY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'PRODUCTION_RECOVERY_SHA must be a full lowercase Git SHA-1 (40 hexadecimal characters)\n' >&2
  exit 1
fi
if [ "$PRODUCTION_RECOVERY_SHA" != "$SOURCE_SHA" ]; then
  printf 'Recovery source SHA does not match PRODUCTION_RECOVERY_SHA\n' >&2
  exit 1
fi
if ! git -C "$SOURCE_ROOT" diff --quiet -- . ||
  ! git -C "$SOURCE_ROOT" diff --cached --quiet -- .; then
  printf 'Recovery source checkout has uncommitted changes; refusing to package mutable bytes\n' >&2
  exit 1
fi

contract_file="$SCRIPT_DIR/lib/production-recovery-contract.sh"
contract_version="$(awk -F= '$1 == "PRODUCTION_RECOVERY_CONTRACT_VERSION" { print $2; exit }' "$contract_file")"
source_version="$(awk -F= '$1 == "PRODUCTION_RECOVERY_SOURCE_VERSION" { print $2; exit }' "$contract_file")"
if [[ ! "$contract_version" =~ ^[0-9]+$ ]] || [[ ! "$source_version" =~ ^[0-9]+$ ]]; then
  printf 'Recovery contract and source version must be numeric\n' >&2
  exit 1
fi

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

printf 'PRODUCTION_RECOVERY_SOURCE_SHA=%s\n' "$SOURCE_SHA" > "$TMP_DIR/lib/recovery-authority.env"
printf 'PRODUCTION_RECOVERY_CONTRACT_VERSION=%s\n' "$contract_version" >> "$TMP_DIR/lib/recovery-authority.env"
printf 'PRODUCTION_RECOVERY_SOURCE_VERSION=%s\n' "$source_version" >> "$TMP_DIR/lib/recovery-authority.env"
chmod 600 "$TMP_DIR/lib/recovery-authority.env"

tar -czf "$OUTPUT_PATH" -C "$TMP_DIR" production-recovery-executor.sh lib
printf '%s\n' "$OUTPUT_PATH"
