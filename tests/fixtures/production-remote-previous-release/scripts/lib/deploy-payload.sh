#!/usr/bin/env bash
# deploy-payload.sh - Versioned predecessor contract fixture

decode_deploy_payload_base64() {
  local payload_b64="$1"
  local target_path="${2:-$(mktemp)}"

  [ -n "$payload_b64" ] || return 1
  printf '%s' "$payload_b64" | base64 --decode > "$target_path"
  printf '%s\n' "$target_path"
}

deploy_payload_get() {
  local payload_path="$1"
  local key="$2"

  awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); found=1; exit } END { exit(found ? 0 : 1) }' "$payload_path"
}
