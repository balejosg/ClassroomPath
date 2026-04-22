#!/usr/bin/env bash

set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"
ZERO_SHA="0000000000000000000000000000000000000000"

if [ -z "$BASE_SHA" ] || [ "$BASE_SHA" = "$ZERO_SHA" ] || [ -z "$HEAD_SHA" ]; then
  echo "No release-candidate diff base to fetch; detector will rebuild every image family."
  exit 0
fi

git fetch --no-tags --depth=1 origin "$BASE_SHA" "$HEAD_SHA"

openpath_base_sha="$(git rev-parse "$BASE_SHA:upstream/openpath" 2>/dev/null || true)"
openpath_head_sha="$(git rev-parse "$HEAD_SHA:upstream/openpath" 2>/dev/null || true)"

if [ -z "$openpath_base_sha" ] || [ -z "$openpath_head_sha" ]; then
  exit 0
fi

if ! git -C upstream/openpath rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

git -C upstream/openpath fetch --no-tags --depth=1 origin "$openpath_base_sha" "$openpath_head_sha"
