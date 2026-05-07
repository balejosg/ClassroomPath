#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/deploy-images.sh
source "$SCRIPT_DIR/lib/deploy-images.sh"

if [ -z "${SMOKE_TEST_URL:-}" ] || [ -z "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ]; then
  echo "SMOKE_TEST_URL and CLASSROOMPATH_VERIFIER_IMAGE are required" >&2
  exit 1
fi

write_smoke_failure_boundary() {
  local boundary_id="$1"
  local message="$2"

  FAILURE_BOUNDARY_ID="$boundary_id" FAILURE_BOUNDARY_MESSAGE="$message" node <<'NODE'
const fs = require('node:fs');

const failureBoundary = {
  id: process.env.FAILURE_BOUNDARY_ID ?? 'unknown',
  message: process.env.FAILURE_BOUNDARY_MESSAGE ?? '',
};

fs.writeFileSync(
  'smoke-failure-boundary.json',
  `${JSON.stringify(
    {
      success: failureBoundary.id === 'none',
      failureBoundary,
    },
    null,
    2
  )}\n`
);
NODE
}

write_smoke_failure_boundary "none" "success"

echo "Running smoke tests against $SMOKE_TEST_URL via $CLASSROOMPATH_VERIFIER_IMAGE"
if ! docker_prepare_required_image "$CLASSROOMPATH_VERIFIER_IMAGE" "verifier image"; then
  write_smoke_failure_boundary \
    "verifier-image-pull" \
    "Unable to pull or inspect the ClassroomPath verifier image before smoke tests."
  exit 1
fi

docker run --rm \
  -e SMOKE_TEST_URL \
  -e SMOKE_TEST_TIMEOUT \
  -e SMOKE_SKIP_CORS \
  -e SMOKE_ALLOW_MUTATIONS \
  -e SMOKE_TEST_RESOLVED_ADDRESS \
  -e SMOKE_REQUIRE_PUSH \
  "$CLASSROOMPATH_VERIFIER_IMAGE" \
  npm run test:smoke 2>&1 | tee smoke-results.txt

smoke_exit_code=${PIPESTATUS[0]}
if [ "$smoke_exit_code" -ne 0 ]; then
  write_smoke_failure_boundary \
    "smoke-test-failed" \
    "The verifier image ran, but the ClassroomPath smoke test suite failed."
fi

exit "$smoke_exit_code"
