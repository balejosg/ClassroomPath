#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/github-token.sh
source "$SCRIPT_DIR/lib/github-token.sh"

require_cmd git
require_cmd bash

usage() {
  cat <<'EOF'
Usage: bash scripts/tag-production-release.sh <tag> [--local-only]

Creates the canonical production tag from origin/main after verifying that the
currently deployed staging release is promotion-ready.

Examples:
  bash scripts/tag-production-release.sh v1.2.120
  bash scripts/tag-production-release.sh v1.2.120 --local-only
EOF
}

TAG_NAME="${1:-}"
PUSH_MODE="${2:-}"

if [ -z "$TAG_NAME" ]; then
  usage
  die "Missing required tag argument" 1
fi

if [[ ! "$TAG_NAME" =~ ^v[0-9]+(\.[0-9]+){2,}$ ]]; then
  die "Production tag must look like v<major>.<minor>.<patch>" 1
fi

if [ -n "$PUSH_MODE" ] && [ "$PUSH_MODE" != "--local-only" ]; then
  usage
  die "Unsupported option: $PUSH_MODE" 1
fi

cd "$PROJECT_ROOT"
bash scripts/require-main-branch.sh git ClassroomPath

WORKSPACE_GUARD="$SCRIPT_DIR/../../scripts/parallel_session_guard.py"

resolve_active_release_fence_id() {
  local fence_json="$1"
  local target_sha="$2"

  FENCE_JSON="$fence_json" TARGET_SHA="$target_sha" node <<'NODE'
const fence = JSON.parse(process.env.FENCE_JSON || '{}');
const targetSha = String(process.env.TARGET_SHA || '');
const releaseId = String(fence.release_id || '');
const fenceSha = String(fence.classroompath_sha || '');

if (releaseId && (!fenceSha || fenceSha === targetSha)) {
  console.log(releaseId);
}
NODE
}

if ! git diff --quiet --ignore-submodules=dirty || ! git diff --cached --quiet --ignore-submodules=dirty; then
  die "Working tree must be clean before creating a production tag" 1
fi

git fetch origin main --quiet

current_sha="$(git rev-parse HEAD)"
main_sha="$(git rev-parse origin/main)"
if [ "$current_sha" != "$main_sha" ]; then
  die "HEAD must match origin/main before creating a production tag" 1
fi

if [ -f "$WORKSPACE_GUARD" ]; then
  fence_json="$(python3 "$WORKSPACE_GUARD" release-status)"
  case "$fence_json" in
    \{*)
      ;;
    *)
      die "Release fence must be staged before production tagging" 1
      ;;
  esac
  if ! printf '%s' "$fence_json" | python3 -c '
import json
import sys
payload = json.load(sys.stdin)
if payload.get("state") != "staged":
    raise SystemExit(1)
'; then
    die "Release fence must be staged before production tagging" 1
  fi
  fence_sha="$(printf '%s' "$fence_json" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("classroompath_sha", ""))')"
  if [ "$fence_sha" != "$main_sha" ]; then
    die "Release fence SHA $fence_sha does not match origin/main $main_sha" 1
  fi
  release_fence_id="$(resolve_active_release_fence_id "$fence_json" "$main_sha")"
  if [ -z "$release_fence_id" ]; then
    die "Release fence must resolve to a release id for origin/main $main_sha" 1
  fi
fi

if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null 2>&1; then
  die "Local tag already exists: $TAG_NAME" 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG_NAME" >/dev/null 2>&1; then
  die "Remote tag already exists on origin: $TAG_NAME" 1
fi

promotion_evidence_dir="$(mktemp -d)"
tag_message_file="$(mktemp)"
cleanup() {
  rm -rf "$promotion_evidence_dir"
  rm -f "$tag_message_file"
}
trap cleanup EXIT

log_info "Verifying staging promotion eligibility before tagging $TAG_NAME..."
ensure_github_token_env
PROMOTION_EVIDENCE_DIR="$promotion_evidence_dir" bash scripts/verify-production-promotion-ready.sh

log_info "Verifying production target readiness before tagging $TAG_NAME..."
bash scripts/preflight-production-promotion-target.sh

node scripts/promotion-evidence-cli.mjs write-tag-message \
  --tag "$TAG_NAME" \
  --commit "$main_sha" \
  --staging-current "$promotion_evidence_dir/staging-current-images.env" \
  --staging-verification "$promotion_evidence_dir/staging-verification.env" \
  --output "$tag_message_file"

git tag -a "$TAG_NAME" "$main_sha" -F "$tag_message_file"
log_success "Created production tag $TAG_NAME at $main_sha"

if [ -f "$WORKSPACE_GUARD" ]; then
  python3 "$WORKSPACE_GUARD" release-mark-tagged --release-id "$release_fence_id" --tag "$TAG_NAME"
fi

if [ "$PUSH_MODE" = "--local-only" ]; then
  log_info "Skipping push because --local-only was requested"
  exit 0
fi

git push origin "$TAG_NAME"
log_success "Pushed production tag $TAG_NAME to origin"
