#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ $# -lt 1 ]; then
  echo "usage: $0 <build|verify:static> [extra turbo args...]" >&2
  exit 1
fi

MODE="$1"
shift

if [ -x "$ROOT_DIR/node_modules/.bin/turbo" ]; then
  TURBO_BIN="$ROOT_DIR/node_modules/.bin/turbo"
elif [ -x "$ROOT_DIR/upstream/openpath/node_modules/.bin/turbo" ]; then
  TURBO_BIN="$ROOT_DIR/upstream/openpath/node_modules/.bin/turbo"
else
  echo "turbo binary not found in root or upstream/openpath installs" >&2
  exit 1
fi

cd "$ROOT_DIR"

case "$MODE" in
  build)
    exec "$TURBO_BIN" run build \
      --filter=@classroompath/api \
      --filter=@classroompath/react-spa \
      --output-logs=new-only \
      "$@"
    ;;
  verify:static)
    exec "$TURBO_BIN" run typecheck lint \
      --filter=@classroompath/api \
      --filter=@classroompath/contracts \
      --filter=@classroompath/presenters \
      --filter=@classroompath/react-spa \
      --filter=@classroompath/testkit \
      --output-logs=new-only \
      "$@"
    ;;
  *)
    echo "unsupported turbo mode: $MODE" >&2
    exit 1
    ;;
esac
