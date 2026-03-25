#!/usr/bin/env bash
# build-openpath.sh - Build OpenPath submodule packages in correct order
#
# This script ensures shared is built before api to avoid module resolution issues.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OPENPATH_DIR="$ROOT_DIR/upstream/openpath"

echo "Building OpenPath packages..."

# 1. Build shared first (required for API types)
echo "[1/5] Building @openpath/shared..."
cd "$OPENPATH_DIR/shared"
rm -rf dist tsconfig.tsbuildinfo
npx tsc -p tsconfig.json

# 2. Build API (depends on shared)
echo "[2/5] Building @openpath/api..."
cd "$OPENPATH_DIR/api"
rm -rf dist
npx tsc -p tsconfig.build.json

# 3. Build react-spa
echo "[3/5] Building @openpath/react-spa..."
cd "$OPENPATH_DIR/react-spa"
npm run build

# 4. Build dashboard
echo "[4/5] Building @openpath/dashboard..."
cd "$OPENPATH_DIR/dashboard"
npm run build

# 5. Build firefox-extension
echo "[5/6] Building @openpath/firefox-extension..."
cd "$OPENPATH_DIR/firefox-extension"
npm run build

# 6. Prepare managed Chromium artifacts when the environment supports packaging
echo "[6/6] Preparing managed Chromium extension artifacts..."
npm run build:chromium-managed

echo "All OpenPath packages built successfully!"
