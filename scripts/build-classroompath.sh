#!/usr/bin/env bash
# build-classroompath.sh - Build ClassroomPath packages in correct order
#
# Aligns local builds with Dockerfile.cp-api:
# - Build upstream OpenPath shared types first
# - Build ClassroomPath internal shared packages
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

echo "[3/6] Building @classroompath/contracts..."
npm run clean:all --workspace=@classroompath/contracts
npm run build --workspace=@classroompath/contracts

echo "[4/6] Building @classroompath/testkit..."
npm run clean:all --workspace=@classroompath/testkit
npm run build --workspace=@classroompath/testkit

echo "[5/6] Building @classroompath/react-spa..."
npm run build --workspace=@classroompath/react-spa

echo "[6/6] Building @classroompath/api..."
npm run build --workspace=@classroompath/api

echo "Build completed successfully."
