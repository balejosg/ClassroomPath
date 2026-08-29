#!/bin/sh
# run-migrations-image.sh - Entry point for the prebuilt ClassroomPath migrations image

set -eu

usage() {
  cat <<'EOF'
Usage:
  sh scripts/run-migrations-image.sh [--cp] [--openpath] [--confirm-windows-offline-installer-legacy-retirement]

Options:
  --cp        Run ClassroomPath gateway schema push
  --openpath  Run OpenPath core schema push
  --confirm-windows-offline-installer-legacy-retirement
              Apply the deferred destructive legacy-ref retirement migration once the drain is proven

Notes:
  - If no schema flags are provided, both schema pushes are run.
  - DATABASE_URL stays canonical; OpenPath DB_* compatibility env is derived from a shared helper when needed.
EOF
}

RUN_CP=0
RUN_OPENPATH=0
CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT=0

# Do not let a value inherited from a persistent env file authorize the
# deferred destructive migration. The CLI parser below is the only source of
# confirmation for this process.
unset CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED

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
    --confirm-windows-offline-installer-legacy-retirement)
      CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT=1
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

if [ "$CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT" = "1" ] && [ "$RUN_CP" = "0" ]; then
  echo "The Windows offline installer legacy retirement confirmation requires --cp" >&2
  exit 1
fi

if [ "$CONFIRM_WINDOWS_OFFLINE_INSTALLER_LEGACY_RETIREMENT" = "1" ]; then
  export CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED=1
fi

cd /app
eval "$(node scripts/derive-openpath-db-env.mjs)"

if [ "$RUN_CP" = "1" ]; then
  echo "[MIGRATIONS] - ClassroomPath API schema..."
  node --import tsx api/scripts/cleanup-cp-schema.ts
  node --import tsx api/scripts/baseline-cp-migrations.ts
  npm run db:migrate -w @classroompath/api
fi

if [ "$RUN_OPENPATH" = "1" ]; then
  echo "[MIGRATIONS] - OpenPath API schema..."
  npm run db:migrate -w @openpath/api
fi
