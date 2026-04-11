#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node "$SCRIPT_DIR/release-risk-cli.mjs" detect-github-output \
  --github-output "${GITHUB_OUTPUT:-}"
