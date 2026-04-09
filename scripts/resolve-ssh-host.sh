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
  IP=""

  if [ -z "$IP" ]; then
    if command -v getent >/dev/null 2>&1; then
      IP=$(getent hosts "$HOST" 2>/dev/null | awk '{print $1}' | head -1 || true)
    fi
  fi

  if [ -z "$IP" ]; then
    if command -v getent >/dev/null 2>&1; then
      IP=$(getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | head -1 || true)
    fi
  fi

  if [ -z "$IP" ]; then
    if command -v dig >/dev/null 2>&1; then
      IP=$(dig +short "$HOST" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
    fi
  fi

  if [ -z "$IP" ]; then
    if command -v nslookup >/dev/null 2>&1; then
      IP=$(nslookup "$HOST" 1.1.1.1 2>/dev/null | awk '/^Address: / {print $2}' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -1 || true)
    fi
  fi

  if [ -z "$IP" ]; then
    if command -v powershell.exe >/dev/null 2>&1; then
      IP=$(powershell.exe -NoProfile -Command "[System.Net.Dns]::GetHostAddresses('$HOST') | Where-Object { \$_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | Select-Object -First 1 -ExpandProperty IPAddressToString" 2>/dev/null | tr -d '\r' | head -1)
    elif command -v pwsh >/dev/null 2>&1; then
      IP=$(pwsh -NoProfile -Command "[System.Net.Dns]::GetHostAddresses('$HOST') | Where-Object { \$_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | Select-Object -First 1 -ExpandProperty IPAddressToString" 2>/dev/null | tr -d '\r' | head -1)
    fi
  fi

  if [ -z "$IP" ]; then
    if command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
      IP=$(curl -fsSL "https://dns.google/resolve?name=${HOST}&type=A" 2>/dev/null | python3 -c 'import json,sys; data=json.load(sys.stdin); answers=data.get("Answer") or []; ips=[item.get("data","") for item in answers if item.get("type")==1]; print(ips[0] if ips else "")' 2>/dev/null || true)
    fi
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
