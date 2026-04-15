#!/usr/bin/env bash
# build-openpath.sh - Build OpenPath submodule packages in correct order
#
# This script ensures shared is built before api to avoid module resolution issues.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building OpenPath packages..."

echo "[1/5] Building @openpath/shared..."
bash "$SCRIPT_DIR/run-openpath.sh" npm run build --workspace=@openpath/shared

echo "[2/5] Building @openpath/api..."
bash "$SCRIPT_DIR/run-openpath.sh" npm run build --workspace=@openpath/api

echo "[3/5] Building @openpath/react-spa..."
bash "$SCRIPT_DIR/run-openpath.sh" npm run build --workspace=@openpath/react-spa

echo "[4/5] Building @openpath/dashboard..."
bash "$SCRIPT_DIR/run-openpath.sh" npm run build --workspace=@openpath/dashboard

echo "[5/6] Building @openpath/firefox-extension..."
bash "$SCRIPT_DIR/run-openpath.sh" npm run build --workspace=@openpath/firefox-extension

echo "[6/6] Preparing managed Chromium extension artifacts..."
bash "$SCRIPT_DIR/run-openpath.sh" npm run build:chromium-managed --workspace=@openpath/firefox-extension

echo "All OpenPath packages built successfully!"
