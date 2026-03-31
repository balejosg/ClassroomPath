#!/usr/bin/env bash

set -euo pipefail

HOST="${1:-}"
PORT="${2:-22}"
MAX_RETRIES="${3:-3}"

if [ -z "$HOST" ]; then
  echo "Host is required" >&2
  exit 1
fi

for attempt in $(seq 1 "$MAX_RETRIES"); do
  IP=$(getent hosts "$HOST" 2>/dev/null | awk '{print $1}' | head -1)

  if [ -z "$IP" ]; then
    IP=$(dig +short "$HOST" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
  fi

  if [ -n "$IP" ]; then
    printf 'ip=%s\n' "$IP"
    printf 'port=%s\n' "$PORT"
    exit 0
  fi

  sleep 5
done

echo "Could not resolve $HOST" >&2
exit 1
