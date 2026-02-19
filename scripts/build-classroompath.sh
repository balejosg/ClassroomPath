#!/usr/bin/env bash
# build-classroompath.sh - Build ClassroomPath packages in correct order
#
# Aligns local builds with Dockerfile.cp-api:
# - Build upstream OpenPath shared types first
# - Build ClassroomPath React SPA
# - Build ClassroomPath gateway API

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "Building ClassroomPath packages..."

echo "[1/4] Building @openpath/shared..."
npm run clean:all --workspace=@openpath/shared
npm run build --workspace=@openpath/shared

echo "[2/4] Building @openpath/api..."
npm run clean:all --workspace=@openpath/api
npm run build --workspace=@openpath/api

echo "[3/4] Building @classroompath/react-spa..."
npm run build --workspace=@classroompath/react-spa

echo "[4/4] Building @classroompath/api..."
npm run build --workspace=@classroompath/api

echo "Build completed successfully."
