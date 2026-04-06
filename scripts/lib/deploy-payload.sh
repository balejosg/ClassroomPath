#!/usr/bin/env bash
# shellcheck shell=bash

decode_deploy_payload_base64() {
  local payload_b64="$1"
  local target_path="${2:-$(mktemp)}"

  if [ -z "$payload_b64" ]; then
    log_error "Deploy payload is empty"
    return 1
  fi

  printf '%s' "$payload_b64" | base64 --decode > "$target_path"
  printf '%s\n' "$target_path"
}

deploy_payload_get() {
  local payload_path="$1"
  local key="$2"

  awk -v key="$key" '
    index($0, key "=") == 1 {
      print substr($0, length(key) + 2)
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$payload_path"
}
