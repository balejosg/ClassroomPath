#!/usr/bin/env bash

set -euo pipefail

READY_URL="${1:-}"
MAX_ATTEMPTS="${2:-30}"
SLEEP_SECONDS="${3:-2}"

if [ -z "$READY_URL" ]; then
  echo "Ready URL is required" >&2
  exit 1
fi

last_response=''
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  last_response="$(curl -fsS "$READY_URL" 2>/dev/null || true)"
  if printf '%s' "$last_response" | grep -q '"ready":true'; then
    echo "Ready after attempt $attempt"
    exit 0
  fi

  echo "Not ready yet (attempt $attempt/$MAX_ATTEMPTS)"
  sleep "$SLEEP_SECONDS"
done

echo "Readiness did not converge within $((MAX_ATTEMPTS * SLEEP_SECONDS)) seconds" >&2
printf '%s\n' "$last_response" >&2
exit 1
