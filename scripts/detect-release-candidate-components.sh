#!/usr/bin/env bash

set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"

mark_all_changed() {
  gateway_changed=true
  migrations_changed=true
  openpath_api_changed=true
  spa_changed=true
  verifier_changed=true
}

gateway_changed=false
migrations_changed=false
openpath_api_changed=false
spa_changed=false
verifier_changed=false

if [ -z "$BASE_SHA" ] || [ "$BASE_SHA" = "0000000000000000000000000000000000000000" ] || [ -z "$HEAD_SHA" ]; then
  mark_all_changed
else
  changed_files="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA" || true)"
  if [ -z "$changed_files" ]; then
    changed_files="$(git show --pretty='' --name-only "$HEAD_SHA")"
  fi

  echo "Changed files:"
  if [ -n "$changed_files" ]; then
    echo "$changed_files"
  else
    echo "(none)"
  fi

  while IFS= read -r file; do
    [ -z "$file" ] && continue

    case "$file" in
      package.json|package-lock.json|scripts/*|.github/actions/setup-node/*|.github/actions/setup-docker-build/*|.github/workflows/release-candidate-images.yml)
        mark_all_changed
        ;;
      api/drizzle/*|api/drizzle/**|api/drizzle.config.ts|api/src/db/*|api/src/db/**|api/scripts/*|api/package*.json)
        gateway_changed=true
        migrations_changed=true
        verifier_changed=true
        ;;
      api/*|docker/Dockerfile.cp-api|config/*)
        gateway_changed=true
        verifier_changed=true
        ;;
      react-spa/*|docker/Dockerfile.spa)
        spa_changed=true
        verifier_changed=true
        ;;
      tests/*|docker/Dockerfile.release-verifier|.github/workflows/smoke-tests.yml|.github/workflows/deploy.yml)
        verifier_changed=true
        ;;
      docker/Dockerfile.migrations)
        migrations_changed=true
        ;;
      upstream/openpath/*|docker/Dockerfile.api|.github/workflows/firefox-release-assets.yml)
        openpath_api_changed=true
        migrations_changed=true
        verifier_changed=true
        ;;
    esac
  done <<< "$changed_files"
fi

echo "gateway_changed=$gateway_changed" >> "$GITHUB_OUTPUT"
echo "migrations_changed=$migrations_changed" >> "$GITHUB_OUTPUT"
echo "openpath_api_changed=$openpath_api_changed" >> "$GITHUB_OUTPUT"
echo "spa_changed=$spa_changed" >> "$GITHUB_OUTPUT"
echo "verifier_changed=$verifier_changed" >> "$GITHUB_OUTPUT"
