#!/usr/bin/env bash
# rollback-readiness.sh - shared health/readiness gate for release rollback
# shellcheck shell=bash

rollback_readiness_json_is_ready() {
  local response="$1"
  local node_bin="${NODE_BIN:-}"

  if [ -z "$node_bin" ]; then
    node_bin="$(command -v node 2>/dev/null || true)"
  fi

  if [ -z "$node_bin" ]; then
    log_error "Node is required to validate the rollback readiness JSON contract"
    return 1
  fi

  printf '%s' "$response" |
    "$node_bin" -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const parsed = JSON.parse(input);
          const valid = parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            parsed.ready === true;
          process.exit(valid ? 0 : 1);
        } catch {
          process.exit(1);
        }
      });
    '
}

rollback_wait_for_health_and_readiness() {
  local base_url="${1:-${ROLLBACK_PUBLIC_URL:-http://localhost:3001}}"
  local attempts="${2:-${ROLLBACK_READINESS_ATTEMPTS:-12}}"
  local delay_seconds="${3:-${ROLLBACK_READINESS_DELAY_SECONDS:-5}}"
  local curl_timeout_seconds="${4:-${ROLLBACK_READINESS_CURL_TIMEOUT_SECONDS:-10}}"
  local health_url="${base_url%/}/cp/health"
  local ready_url="${base_url%/}/cp/ready"
  local ready_response=""
  local ready_response_file=""
  local health_http_status=""
  local ready_http_status=""
  local attempt=0

  case "$attempts" in
    ''|*[!0-9]*)
      log_error "Invalid rollback readiness attempt count"
      return 1
      ;;
  esac
  case "$delay_seconds" in
    ''|*[!0-9]*)
      log_error "Invalid rollback readiness delay"
      return 1
      ;;
  esac
  case "$curl_timeout_seconds" in
    ''|*[!0-9]*)
      log_error "Invalid rollback readiness curl timeout"
      return 1
      ;;
  esac
  if [ "$attempts" -lt 1 ]; then
    log_error "Rollback readiness attempt count must be positive"
    return 1
  fi
  if [ "$curl_timeout_seconds" -lt 1 ]; then
    log_error "Rollback readiness curl timeout must be positive"
    return 1
  fi

  if ! ready_response_file="$(mktemp)"; then
    log_error "Unable to create a temporary rollback readiness response file"
    return 1
  fi

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if health_http_status="$(curl -fsS --max-time "$curl_timeout_seconds" -o /dev/null -w '%{http_code}' "$health_url" 2>/dev/null)" &&
      [ "$health_http_status" = "200" ]; then
      break
    fi
    if [ "$attempt" -eq "$attempts" ]; then
      log_error "Rolled-back release did not become healthy"
      rm -f "$ready_response_file" || true
      return 1
    fi
    if ! sleep "$delay_seconds"; then
      rm -f "$ready_response_file" || true
      return 1
    fi
  done

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if ready_http_status="$(curl -fsS --max-time "$curl_timeout_seconds" -o "$ready_response_file" -w '%{http_code}' "$ready_url" 2>/dev/null)" &&
      [ "$ready_http_status" = "200" ] &&
      ready_response="$(cat "$ready_response_file")" &&
      rollback_readiness_json_is_ready "$ready_response"; then
      rm -f "$ready_response_file" || true
      return 0
    fi

    if [ "$attempt" -eq "$attempts" ]; then
      log_error "Rolled-back release did not satisfy the readiness JSON contract"
      rm -f "$ready_response_file" || true
      return 1
    fi
    if ! sleep "$delay_seconds"; then
      rm -f "$ready_response_file" || true
      return 1
    fi
  done

  rm -f "$ready_response_file" || true
  return 1
}
