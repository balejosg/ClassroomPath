#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage: run-staging-smoke.sh <state-file> <staging-host> <smoke-url> <ssh-cmd...>" >&2
  exit 2
fi

STATE_FILE="$1"
STAGING_HOST="$2"
SMOKE_TARGET_URL="$3"
shift 3
SSH_CMD=("$@")

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

SMOKE_SKIP_CORS="0"
STAGING_VERIFICATION_STATUS="PASS"

SMOKE_TARGET_HOST=$(printf '%s\n' "$SMOKE_TARGET_URL" | sed -E 's#^[A-Za-z]+://([^/:]+).*#\1#')

if [ -n "$SMOKE_TARGET_HOST" ] && ! getent hosts "$SMOKE_TARGET_HOST" >/dev/null 2>&1; then
  echo "Smoke URL host does not resolve locally: $SMOKE_TARGET_HOST" >&2
  REMOTE_DNS_STATUS="$("${SSH_CMD[@]}" "getent hosts '$SMOKE_TARGET_HOST' >/dev/null 2>&1 && echo ok || echo fail")"

  if [ "$REMOTE_DNS_STATUS" = "ok" ]; then
    echo "Host resolves on staging host but not locally; using direct IP fallback for local smoke runner" >&2
  else
    echo "Host does not resolve on staging host either; likely DNS outage/missing record" >&2
  fi

  SMOKE_TARGET_URL="http://$STAGING_HOST:3001"
  SMOKE_SKIP_CORS="1"
  STAGING_VERIFICATION_STATUS="PASS_WITH_FALLBACK"
  echo "Falling back smoke target to direct staging gateway: $SMOKE_TARGET_URL" >&2
fi

echo "Smoke target URL: $SMOKE_TARGET_URL" >&2
if [ "$SMOKE_SKIP_CORS" = "1" ]; then
  echo "Strict CORS origin check disabled for fallback smoke run" >&2
fi

set +e
SMOKE_TEST_URL="$SMOKE_TARGET_URL" \
SMOKE_TEST_TIMEOUT="15000" \
SMOKE_SKIP_CORS="$SMOKE_SKIP_CORS" \
SMOKE_ALLOW_MUTATIONS="1" \
npm run test:smoke 2>&1 | tee /tmp/smoke-results.txt

SMOKE_EXIT_CODE=${PIPESTATUS[0]}
set -e

if [ "$SMOKE_EXIT_CODE" -eq 0 ]; then
  echo "Smoke tests passed" >&2
  echo "Verification status: $STAGING_VERIFICATION_STATUS" >&2
  if [ "$STAGING_VERIFICATION_STATUS" = "PASS_WITH_FALLBACK" ]; then
    echo "Fallback mode used; rerun once public DNS recovers before cutting a production tag" >&2
  fi
else
  echo "Smoke tests FAILED (exit code: $SMOKE_EXIT_CODE)" >&2
  echo "Review output above for details" >&2
  echo >&2
  echo "Common issues:" >&2
  echo "  - NPM reverse proxy not routing correctly" >&2
  echo "  - CORS_ORIGINS missing staging domain" >&2
  echo "  - Container started but not fully ready" >&2
  echo >&2
  echo "Debug commands:" >&2
  echo "  ssh deploy@$STAGING_HOST 'docker logs classroompath-gateway --tail 50'" >&2
  echo "  ssh deploy@$STAGING_HOST 'docker logs classroompath-api --tail 50'" >&2
  echo "  curl -v $SMOKE_TARGET_URL/health" >&2
  exit 1
fi

cat > "$STATE_FILE" <<EOF
SMOKE_TARGET_URL=$SMOKE_TARGET_URL
SMOKE_SKIP_CORS=$SMOKE_SKIP_CORS
STAGING_VERIFICATION_STATUS=$STAGING_VERIFICATION_STATUS
EOF
