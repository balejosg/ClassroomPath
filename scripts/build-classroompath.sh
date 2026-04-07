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

bash scripts/run-turbo.sh build

echo "Build completed successfully."
