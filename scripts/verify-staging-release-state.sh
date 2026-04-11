#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

node "$SCRIPT_DIR/release-state-cli.mjs" verify-staging \
  --current ./staging-release-state.env \
  --verification ./staging-verification.env \
  --high-risk "${HIGH_RISK:-false}" \
  --github-output "${GITHUB_OUTPUT:-}"
