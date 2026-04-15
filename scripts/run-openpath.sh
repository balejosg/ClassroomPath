#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OPENPATH_DIR="${OPENPATH_DIR:-$ROOT_DIR/upstream/openpath}"
TARGET_DIR="$OPENPATH_DIR"

if [ $# -eq 0 ]; then
  echo "usage: $0 [--path <subdir>] <command> [args...]" >&2
  exit 1
fi

if [ "${1:-}" = "--path" ]; then
  if [ $# -lt 3 ]; then
    echo "usage: $0 [--path <subdir>] <command> [args...]" >&2
    exit 1
  fi

  TARGET_DIR="$OPENPATH_DIR/$2"
  shift 2
fi

cd "$TARGET_DIR"
exec "$@"
