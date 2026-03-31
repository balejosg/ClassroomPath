#!/bin/sh
# run-migrations-image.sh - Entry point for the prebuilt ClassroomPath migrations image

set -eu

usage() {
  cat <<'EOF'
Usage:
  sh scripts/run-migrations-image.sh [--cp] [--openpath]

Options:
  --cp        Run ClassroomPath gateway schema push
  --openpath  Run OpenPath core schema push

Notes:
  - If no schema flags are provided, both schema pushes are run.
  - DATABASE_URL stays canonical; OpenPath DB_* compatibility env is derived from a shared helper when needed.
EOF
}

RUN_CP=0
RUN_OPENPATH=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cp)
      RUN_CP=1
      shift
      ;;
    --openpath)
      RUN_OPENPATH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$RUN_CP" = "0" ] && [ "$RUN_OPENPATH" = "0" ]; then
  RUN_CP=1
  RUN_OPENPATH=1
fi

cd /app
eval "$(node scripts/derive-openpath-db-env.mjs)"

if [ "$RUN_CP" = "1" ]; then
  echo "[MIGRATIONS] - ClassroomPath API schema..."
  node --import tsx api/scripts/ensure-legacy-cp-schema.ts
  npm run db:push -w @classroompath/api
fi

if [ "$RUN_OPENPATH" = "1" ]; then
  echo "[MIGRATIONS] - OpenPath API schema..."
  npm run db:push -w @openpath/api
fi
