#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# shellcheck source=scripts/lib/common.sh
source "$PROJECT_ROOT/scripts/lib/common.sh"

usage() {
  cat <<'EOF'
Usage:
  ./quick-deploy.sh [--yes]

Options:
  --yes   Non-interactive mode; assume "yes" for deploy prompt

Notes:
  - Staging deploys origin/main, not local commits.
  - In --yes mode, this script will NOT auto-push; push manually first.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes|-y)
      DEPLOY_ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage
      exit 2
      ;;
  esac
done

DEPLOY_ASSUME_YES="${DEPLOY_ASSUME_YES:-0}"
export DEPLOY_ASSUME_YES

cd "$PROJECT_ROOT"

echo "========================================="
echo "ClassroomPath Quick Deploy (Staging)"
echo "========================================="
echo ""
echo "Este script despliega origin/main a staging via SSH:"
echo "  npm run deploy:staging"
echo ""

require_cmd git
require_cmd npm

if [ "$DEPLOY_ASSUME_YES" != "1" ]; then
  if ! confirm_with_timeout "¿Listo para desplegar a STAGING?" 30; then
    log_warn "Abortado."
    exit 0
  fi
fi

echo ""
echo "Paso 1: Verificando git state..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Cambios sin commitear detectados. Commit y push primero."
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "❌ Estás en '$branch'. Staging despliega origin/main; cambiá a main primero."
  exit 1
fi

git fetch origin main --quiet || true
local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse origin/main 2>/dev/null || echo "")

if [ -n "$remote_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
  log_warn "Tu main local no coincide con origin/main:"
  echo "  Local:  $local_sha"
  echo "  Remote: $remote_sha"
  echo ""

  if [ "$DEPLOY_ASSUME_YES" = "1" ] || ! is_tty_stdin; then
    die "Push requerido: ejecuta 'git push origin main' y reintenta" 1
  fi

  read -r -p "¿Hacer push a origin/main ahora? (y/n): " push_now
  if [ "$push_now" = "y" ]; then
    git push origin main
  else
    die "Abortado. Staging despliega origin/main, no tu commit local." 1
  fi
fi

echo ""
echo "Paso 2: Desplegando a STAGING..."
npm run deploy:staging

echo ""
echo "✅ Deploy a STAGING completado"
echo ""
echo "PRODUCCIÓN:"
echo "  git tag vX.Y.Z"
echo "  git push origin vX.Y.Z"
