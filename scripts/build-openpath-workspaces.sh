#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -eq 0 ]; then
  echo "usage: $0 <workspace> [workspace...]" >&2
  exit 1
fi

for workspace in "$@"; do
  bash "$SCRIPT_DIR/run-openpath.sh" npm run build --workspace="$workspace"
done
