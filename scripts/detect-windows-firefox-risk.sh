#!/usr/bin/env bash

set -euo pipefail

git fetch --tags --force
PREVIOUS_TAG="$(git tag --sort=-creatordate | grep '^v' | grep -vx "${GITHUB_REF_NAME}" | head -n 1 || true)"

if [ -n "$PREVIOUS_TAG" ]; then
  CHANGED_FILES="$(git diff --name-only "$PREVIOUS_TAG...$GITHUB_SHA")"
else
  CHANGED_FILES="$(git show --pretty='' --name-only "$GITHUB_SHA")"
fi

echo "Changed files since last release:"
if [ -n "$CHANGED_FILES" ]; then
  echo "$CHANGED_FILES"
else
  echo "(none)"
fi

HIGH_RISK=false
if echo "$CHANGED_FILES" | grep -Eq '^(upstream/openpath$|upstream/openpath/windows/|upstream/openpath/linux/|upstream/openpath/firefox-extension/|upstream/openpath/api/src/|upstream/openpath/api/package\.json$|upstream/openpath/api/tests/token-delivery\.test\.ts$|docker/Dockerfile\.api$)'; then
  HIGH_RISK=true
fi

echo "high_risk=$HIGH_RISK" >> "$GITHUB_OUTPUT"
