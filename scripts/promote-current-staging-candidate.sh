#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/github-token.sh
source "$SCRIPT_DIR/lib/github-token.sh"

require_cmd git
require_cmd node
require_cmd ssh

usage() {
  cat <<'EOF'
Usage: bash scripts/promote-current-staging-candidate.sh [--local-only]

Reads the live staging release-state, verifies that current-images.env and
staging-verification.env still describe the same release-candidate SHA, creates
the next patch production tag, and pushes that tag.
EOF
}

PUSH_MODE="${1:-}"
if [ -n "$PUSH_MODE" ] && [ "$PUSH_MODE" != "--local-only" ]; then
  usage
  die "Unsupported option: $PUSH_MODE" 2
fi

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
fi

STAGING_HOST="${STAGING_HOST:-192.168.1.114}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_CONFIG="${STAGING_SSH_CONFIG:-/dev/null}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-accept-new}"

if [ -z "${STAGING_SSH_KEY:-}" ]; then
  die "STAGING_SSH_KEY not set (set it in .env.local or export it)" 1
fi

STAGING_SSH_KEY="$(expand_tilde "$STAGING_SSH_KEY")"
if [ ! -f "$STAGING_SSH_KEY" ]; then
  die "SSH key not found: $STAGING_SSH_KEY" 1
fi

cd "$PROJECT_ROOT"
ensure_github_token_env
git fetch origin main --tags --quiet

current_state_file="$(mktemp)"
verification_state_file="$(mktemp)"
release_manifest_file="$(mktemp)"
promotion_evidence_dir="$(mktemp -d)"
tag_message_file="$(mktemp)"

cleanup() {
  rm -f "$current_state_file" "$verification_state_file" "$release_manifest_file" "$tag_message_file"
  rm -rf "$promotion_evidence_dir"
}
trap cleanup EXIT

SSH_CMD=(
  ssh
  -F "$STAGING_SSH_CONFIG"
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=${STAGING_SSH_STRICT_HOSTKEY}"
  -i "$STAGING_SSH_KEY"
  -p "$STAGING_PORT"
  "${STAGING_USER}@${STAGING_HOST}"
)

"${SSH_CMD[@]}" "cat /opt/classroompath/release-state/current-images.env" > "$current_state_file"
"${SSH_CMD[@]}" "cat /opt/classroompath/release-state/staging-verification.env" > "$verification_state_file"

read_env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { print $2 }' "$file" | tail -1
}

target_sha="$(read_env_value "$current_state_file" APP_SHA)"
current_image_source="$(read_env_value "$current_state_file" IMAGE_SOURCE)"
verified_sha="$(read_env_value "$verification_state_file" STAGING_VERIFIED_APP_SHA)"
verification_state="$(read_env_value "$verification_state_file" STAGING_VERIFICATION_STATE)"
verified_image_source="$(read_env_value "$verification_state_file" STAGING_VERIFIED_IMAGE_SOURCE)"

if [ -z "$target_sha" ]; then
  die "Staging current-images.env does not include APP_SHA" 1
fi

if [ "$target_sha" != "$verified_sha" ]; then
  die "Latest-only promotion failed: staging APP_SHA $target_sha does not match verified SHA ${verified_sha:-unset}" 1
fi

if [ "$verification_state" != "success" ]; then
  die "Latest-only promotion failed: STAGING_VERIFICATION_STATE=${verification_state:-unset}; expected success" 1
fi

if [ "$current_image_source" != "release-candidate" ]; then
  die "Latest-only promotion failed: IMAGE_SOURCE=${current_image_source:-unset}; expected release-candidate" 1
fi

if [ "$verified_image_source" != "release-candidate" ]; then
  die "Latest-only promotion failed: STAGING_VERIFIED_IMAGE_SOURCE=${verified_image_source:-unset}; expected release-candidate" 1
fi

if ! git cat-file -e "$target_sha^{commit}" >/dev/null 2>&1; then
  git fetch --no-tags origin "$target_sha" --quiet
fi

node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest \
  --sha "$target_sha" \
  --output-file "$release_manifest_file" >/dev/null

latest_tag="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)"
if [ -z "$latest_tag" ]; then
  next_tag="v0.1.0"
else
  version="${latest_tag#v}"
  major="${version%%.*}"
  rest="${version#*.}"
  minor="${rest%%.*}"
  patch="${rest##*.}"
  next_tag="v${major}.${minor}.$((patch + 1))"
fi

if git rev-parse -q --verify "refs/tags/$next_tag" >/dev/null 2>&1; then
  die "Local tag already exists: $next_tag" 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$next_tag" >/dev/null 2>&1; then
  die "Remote tag already exists on origin: $next_tag" 1
fi

log_info "Verifying current staging candidate $target_sha before tagging $next_tag..."
TARGET_SHA="$target_sha" PROMOTION_EVIDENCE_DIR="$promotion_evidence_dir" \
  bash "$SCRIPT_DIR/verify-production-promotion-ready.sh"

node "$SCRIPT_DIR/promotion-evidence-cli.mjs" write-tag-message \
  --tag "$next_tag" \
  --commit "$target_sha" \
  --staging-current "$promotion_evidence_dir/staging-current-images.env" \
  --staging-verification "$promotion_evidence_dir/staging-verification.env" \
  --output "$tag_message_file"

git tag -a "$next_tag" "$target_sha" -F "$tag_message_file"
log_success "Created production tag $next_tag at $target_sha"

if [ "$PUSH_MODE" = "--local-only" ]; then
  log_info "Skipping push because --local-only was requested"
  exit 0
fi

if [ -n "${PROMOTION_TAG_PUSH_TOKEN:-}" ]; then
  require_cmd base64
  log_info "Pushing production tag $next_tag with promotion GitHub App token"
  promotion_remote_path="$(git config --get remote.origin.url | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##')"
  promotion_tag_push_header="$(printf 'x-access-token:%s' "$PROMOTION_TAG_PUSH_TOKEN" | base64 | tr -d '\n')"
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $promotion_tag_push_header" \
    push "https://github.com/$promotion_remote_path.git" \
    "refs/tags/$next_tag"
else
  git push origin "$next_tag"
fi
log_success "Pushed production tag $next_tag to origin"
