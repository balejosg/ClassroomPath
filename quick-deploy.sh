#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================="
echo "ClassroomPath Quick Deploy (Staging)"
echo "========================================="
echo ""
echo "Este script despliega origin/main a staging via SSH:"
echo "  npm run deploy:staging"
echo ""

read -r -p "¿Listo para desplegar a STAGING? (y/n): " ready
if [ "$ready" != "y" ]; then
  echo "Abortado."
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "❌ Error: git no está instalado"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ Error: npm no está instalado"
  exit 1
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
  echo "⚠️  Tu main local no coincide con origin/main:"
  echo "  Local:  $local_sha"
  echo "  Remote: $remote_sha"
  echo ""
  read -r -p "¿Hacer push a origin/main ahora? (y/n): " push_now
  if [ "$push_now" = "y" ]; then
    git push origin main
  else
    echo "Abortado. Staging despliega origin/main, no tu commit local."
    exit 1
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
