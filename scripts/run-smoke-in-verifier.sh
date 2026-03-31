#!/usr/bin/env bash

set -euo pipefail

if [ -z "${SMOKE_TEST_URL:-}" ] || [ -z "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ]; then
  echo "SMOKE_TEST_URL and CLASSROOMPATH_VERIFIER_IMAGE are required" >&2
  exit 1
fi

echo "Running smoke tests against $SMOKE_TEST_URL via $CLASSROOMPATH_VERIFIER_IMAGE"
docker run --rm \
  -e SMOKE_TEST_URL \
  -e SMOKE_TEST_TIMEOUT \
  "$CLASSROOMPATH_VERIFIER_IMAGE" \
  npm run test:smoke 2>&1 | tee smoke-results.txt

exit ${PIPESTATUS[0]}
