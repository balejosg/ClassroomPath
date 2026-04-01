#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "Usage: run-staging-release-gate.sh <state-file> <staging-host> <canonical-staging-url> <staging-use-release-candidate> <ssh-cmd...>" >&2
  exit 2
fi

STATE_FILE="$1"
STAGING_HOST="$2"
CANONICAL_STAGING_URL="$3"
STAGING_USE_RELEASE_CANDIDATE="$4"
shift 4
SSH_CMD=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"
RESOLVE_HOST_SCRIPT_PATH="$PROJECT_ROOT/scripts/resolve-ssh-host.sh"

RELEASE_GATE_TARGET_URL="$CANONICAL_STAGING_URL"
RELEASE_GATE_EXPECTED_ORIGIN="$(node -e 'console.log(new URL(process.argv[1]).origin)' "$CANONICAL_STAGING_URL")"
RELEASE_GATE_REQUEST_ORIGIN="$RELEASE_GATE_EXPECTED_ORIGIN"
RELEASE_GATE_TARGET_HOST=$(printf '%s\n' "$CANONICAL_STAGING_URL" | sed -E 's#^[A-Za-z]+://([^/:]+).*#\1#')
RELEASE_GATE_RESOLVED_ADDRESS=""

if [ -n "$RELEASE_GATE_TARGET_HOST" ]; then
  RESOLVER_OUTPUT="$(bash "$RESOLVE_HOST_SCRIPT_PATH" "$RELEASE_GATE_TARGET_HOST" 443 1 2>/dev/null || true)"
  RELEASE_GATE_RESOLVED_ADDRESS="$(printf '%s\n' "$RESOLVER_OUTPUT" | awk -F= '$1=="ip"{print $2}' | head -1)"

  if [ -n "$RELEASE_GATE_RESOLVED_ADDRESS" ]; then
    echo "Release gate host resolved explicitly: $RELEASE_GATE_TARGET_HOST -> $RELEASE_GATE_RESOLVED_ADDRESS" >&2
  elif ! getent hosts "$RELEASE_GATE_TARGET_HOST" >/dev/null 2>&1; then
    echo "Release gate host does not resolve locally and explicit resolution failed: $RELEASE_GATE_TARGET_HOST" >&2
    exit 1
  fi
fi

echo "Release gate target URL: $CANONICAL_STAGING_URL" >&2
echo "Release gate expected origin: $RELEASE_GATE_EXPECTED_ORIGIN" >&2

set +e
RELEASE_GATE_URL="$CANONICAL_STAGING_URL" \
RELEASE_GATE_EXPECTED_ORIGIN="$RELEASE_GATE_EXPECTED_ORIGIN" \
RELEASE_GATE_REQUEST_ORIGIN="$RELEASE_GATE_REQUEST_ORIGIN" \
RELEASE_GATE_TIMEOUT="30000" \
RELEASE_GATE_ALLOW_MUTATIONS="1" \
RELEASE_GATE_RESOLVED_ADDRESS="$RELEASE_GATE_RESOLVED_ADDRESS" \
npm run test:release-gate 2>&1 | tee /tmp/release-gate-results.txt

GATE_EXIT_CODE=${PIPESTATUS[0]}
set -e

if [ "$GATE_EXIT_CODE" -ne 0 ]; then
  echo "Release gate FAILED (exit code: $GATE_EXIT_CODE)" >&2
  echo "Staging was deployed, but promotion evidence was not recorded" >&2
  exit 1
fi

echo "Release gate passed" >&2

STAGING_GATE_RESULT="success"
STAGING_VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Verifying Firefox release artifacts inside classroompath-api..." >&2
"${SSH_CMD[@]}" \
  "docker exec classroompath-api test -f /app/firefox-extension/build/firefox-release/metadata.json && docker exec classroompath-api test -f /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi"

STAGING_FIREFOX_RELEASE_ARTIFACTS="present"
STAGING_FIREFOX_METADATA_JSON="$("${SSH_CMD[@]}" "docker exec classroompath-api cat /app/firefox-extension/build/firefox-release/metadata.json")"
STAGING_FIREFOX_EXTENSION_ID="$(printf '%s' "$STAGING_FIREFOX_METADATA_JSON" | node "$SCRIPT_DIR/read-firefox-release-metadata.mjs" --field extensionId)"
STAGING_FIREFOX_RELEASE_VERSION="$(printf '%s' "$STAGING_FIREFOX_METADATA_JSON" | node "$SCRIPT_DIR/read-firefox-release-metadata.mjs" --field version)"
STAGING_FIREFOX_METADATA_SHA256="$("${SSH_CMD[@]}" "docker exec classroompath-api sha256sum /app/firefox-extension/build/firefox-release/metadata.json | awk '{print \$1}'")"
STAGING_FIREFOX_XPI_SHA256="$("${SSH_CMD[@]}" "docker exec classroompath-api sha256sum /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi | awk '{print \$1}'")"
STAGING_WINDOWS_BOOTSTRAP_RESULT="failed"
STAGING_FIREFOX_POLICY_RESULT="failed"

echo "Running Windows bootstrap gate against staging..." >&2

set +e
WINDOWS_BOOTSTRAP_GATE_URL="$CANONICAL_STAGING_URL" \
WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN="$RELEASE_GATE_EXPECTED_ORIGIN" \
WINDOWS_BOOTSTRAP_GATE_EXPECTED_EXTENSION_ID="$STAGING_FIREFOX_EXTENSION_ID" \
WINDOWS_BOOTSTRAP_GATE_EXPECTED_VERSION="$STAGING_FIREFOX_RELEASE_VERSION" \
WINDOWS_BOOTSTRAP_GATE_EXPECTED_METADATA_SHA256="$STAGING_FIREFOX_METADATA_SHA256" \
WINDOWS_BOOTSTRAP_GATE_EXPECTED_XPI_SHA256="$STAGING_FIREFOX_XPI_SHA256" \
WINDOWS_BOOTSTRAP_GATE_TIMEOUT="30000" \
WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS="$RELEASE_GATE_RESOLVED_ADDRESS" \
npm run test:windows-bootstrap-gate 2>&1 | tee /tmp/windows-bootstrap-gate-results.txt

WINDOWS_BOOTSTRAP_EXIT_CODE=${PIPESTATUS[0]}
set -e

if [ "$WINDOWS_BOOTSTRAP_EXIT_CODE" -eq 0 ]; then
  STAGING_WINDOWS_BOOTSTRAP_RESULT="success"
  STAGING_FIREFOX_POLICY_RESULT="success"
  echo "Windows bootstrap gate passed" >&2
else
  echo "Windows bootstrap gate FAILED (exit code: $WINDOWS_BOOTSTRAP_EXIT_CODE)" >&2

  if [ "$STAGING_USE_RELEASE_CANDIDATE" = "1" ]; then
    echo "Release-candidate staging deploys must prove the live Windows bootstrap contract" >&2
    exit 1
  fi

  echo "Continuing because STAGING_USE_RELEASE_CANDIDATE=$STAGING_USE_RELEASE_CANDIDATE" >&2
fi

cat > "$STATE_FILE" <<EOF
RELEASE_GATE_TARGET_URL=$RELEASE_GATE_TARGET_URL
RELEASE_GATE_EXPECTED_ORIGIN=$RELEASE_GATE_EXPECTED_ORIGIN
STAGING_GATE_RESULT=$STAGING_GATE_RESULT
STAGING_VERIFIED_AT=$STAGING_VERIFIED_AT
STAGING_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS
STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT
STAGING_FIREFOX_EXTENSION_ID=$STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION=$STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_METADATA_SHA256=$STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256=$STAGING_FIREFOX_XPI_SHA256
EOF
