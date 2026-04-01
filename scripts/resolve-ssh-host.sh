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
    IP=$(getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | head -1)
  fi

  if [ -z "$IP" ]; then
    IP=$(dig +short "$HOST" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
  fi

  if [ -z "$IP" ]; then
    IP=$(nslookup "$HOST" 1.1.1.1 2>/dev/null | awk '/^Address: / {print $2}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -1)
  fi

  if [ -z "$IP" ]; then
    IP=$(curl -fsSL "https://dns.google/resolve?name=${HOST}&type=A" 2>/dev/null | python3 -c 'import json,sys; data=json.load(sys.stdin); answers=data.get("Answer") or []; ips=[item.get("data","") for item in answers if item.get("type")==1]; print(ips[0] if ips else "")' 2>/dev/null || true)
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
