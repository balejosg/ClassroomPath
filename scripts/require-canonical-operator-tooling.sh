#!/usr/bin/env bash

set -Eeuo pipefail

bash scripts/require-main-branch.sh git ClassroomPath
git fetch --prune origin main

operator_head="$(git rev-parse HEAD)"
operator_origin_main="$(git rev-parse origin/main)"
if [ "$operator_head" != "$operator_origin_main" ]; then
  echo "operator tooling is not canonical origin/main: HEAD=$operator_head origin/main=$operator_origin_main" >&2
  exit 1
fi
