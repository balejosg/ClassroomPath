#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: check-staging-health.sh <staging-host> <ssh-cmd...>" >&2
  exit 2
fi

STAGING_HOST="$1"
shift
SSH_CMD=("$@")

MAX_ATTEMPTS=30
ATTEMPT=0

# Check gateway readiness
while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))

  HEALTH="$("${SSH_CMD[@]}" "curl -sf http://localhost:3000/cp/ready 2>/dev/null" || echo "")"

  if [ -n "$HEALTH" ]; then
    echo "Gateway ready (attempt $ATTEMPT)"
    break
  fi

  if [ "$ATTEMPT" -eq "$MAX_ATTEMPTS" ]; then
    echo "Gateway readiness check failed after $MAX_ATTEMPTS attempts" >&2
    echo "Debug: ssh deploy@$STAGING_HOST 'docker logs classroompath-gateway --tail 30'" >&2
    exit 1
  fi

  sleep 1
done

# Check API health via gateway (API port 3000 is internal to Docker network only)
# The gateway proxies /health to the API.
sleep 3

ATTEMPT=0
while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))

  API_HEALTH="$("${SSH_CMD[@]}" "curl -sf http://localhost:3000/health 2>/dev/null" || echo "")"

  if echo "$API_HEALTH" | grep -q '"status":"ok"'; then
    echo "API healthy (via gateway, attempt $ATTEMPT)"
    exit 0
  fi

  if [ "$ATTEMPT" -eq "$MAX_ATTEMPTS" ]; then
    echo "API health check failed after $MAX_ATTEMPTS attempts" >&2
    echo "Response: $API_HEALTH" >&2
    echo "Debug: ssh deploy@$STAGING_HOST 'docker logs classroompath-api --tail 30'" >&2
    exit 1
  fi

  sleep 1
done
