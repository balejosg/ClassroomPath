#!/usr/bin/env bash
# rollback-readiness.sh - shared health/readiness gate for release rollback
# shellcheck shell=bash

rollback_readiness_json_is_ready() {
  local response="$1"
  local verifier_image="${CLASSROOMPATH_VERIFIER_IMAGE:-}"
  local compact_response=""

  # Production supplies the exact verifier image from the stored Release
  # Bundle. The small shell fallback exists only for bootstrap diagnostics and
  # tests that intentionally omit Docker; it is deliberately strict about the
  # top-level object and the semantic ready=true field.
  if [ "${ROLLBACK_READINESS_USE_VERIFIER:-0}" = "1" ] && [ -n "$verifier_image" ]; then
    if ! [[ "$verifier_image" =~ @sha256:[0-9a-f]{64}$ ]]; then
      log_error "Rollback readiness requires an immutable verifier image"
      return 1
    fi
    printf '%s' "$response" |
      docker run --rm -i --entrypoint node "$verifier_image" -e '
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
    return $?
  fi

  compact_response="$(printf '%s' "$response" | tr -d '[:space:]')"
  case "$compact_response" in
    '{"ready":true}'|'{"ready":true,'*'}') return 0 ;;
    *) return 1 ;;
  esac
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
