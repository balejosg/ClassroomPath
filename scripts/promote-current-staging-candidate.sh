#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/github-token.sh
source "$SCRIPT_DIR/lib/github-token.sh"
# shellcheck source=lib/production-tag.sh
source "$SCRIPT_DIR/lib/production-tag.sh"

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

STAGING_HOST="${STAGING_HOST:-staging-host.example.invalid}"
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
promotion_evidence_dir="$(mktemp -d)"
tag_message_file="$(mktemp)"

cleanup() {
  rm -f "$current_state_file" "$verification_state_file" "$tag_message_file"
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

"${SSH_CMD[@]}" "cat /srv/classroompath/release-state/current-images.env" > "$current_state_file"
"${SSH_CMD[@]}" "cat /srv/classroompath/release-state/staging-verification.env" > "$verification_state_file"

read_env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { print $2 }' "$file" | tail -1
}

target_sha="$(read_env_value "$current_state_file" APP_SHA)"
current_image_source="$(read_env_value "$current_state_file" IMAGE_SOURCE)"
STAGING_RELEASE_ID="$(read_env_value "$current_state_file" RELEASE_ID)"
STAGING_RC_RUN_ID="$(read_env_value "$current_state_file" RC_RUN_ID)"
STAGING_OPENPATH_SHA="$(read_env_value "$current_state_file" OPENPATH_SHA)"
STAGING_OPENPATH_CONTRACT_SHA256="$(read_env_value "$current_state_file" OPENPATH_CONTRACT_SHA256)"
verified_sha="$(read_env_value "$verification_state_file" STAGING_VERIFIED_APP_SHA)"
verification_state="$(read_env_value "$verification_state_file" STAGING_VERIFICATION_STATE)"
verified_image_source="$(read_env_value "$verification_state_file" STAGING_VERIFIED_IMAGE_SOURCE)"
verified_release_id="$(read_env_value "$verification_state_file" STAGING_VERIFIED_RELEASE_ID)"
verified_rc_run_id="$(read_env_value "$verification_state_file" STAGING_VERIFIED_RC_RUN_ID)"
verified_openpath_sha="$(read_env_value "$verification_state_file" STAGING_VERIFIED_OPENPATH_SHA)"
verified_openpath_contract_sha256="$(read_env_value "$verification_state_file" STAGING_VERIFIED_OPENPATH_CONTRACT_SHA256)"

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

if [ -z "$STAGING_RELEASE_ID" ] || [ -z "$STAGING_RC_RUN_ID" ] || [ -z "$STAGING_OPENPATH_SHA" ] || [ -z "$STAGING_OPENPATH_CONTRACT_SHA256" ]; then
  die "Latest-only promotion failed: staging current-images.env is missing Release Bundle v2 identity or RC run ID" 1
fi
if ! [[ "$STAGING_RC_RUN_ID" =~ ^[0-9]+$ ]]; then
  die "Latest-only promotion failed: staging RC run ID is invalid" 1
fi

if [ "$STAGING_RELEASE_ID" != "$verified_release_id" ] ||
  [ "$STAGING_RC_RUN_ID" != "$verified_rc_run_id" ] ||
  [ "$STAGING_OPENPATH_SHA" != "$verified_openpath_sha" ] ||
  [ "$STAGING_OPENPATH_CONTRACT_SHA256" != "$verified_openpath_contract_sha256" ]; then
  die "Latest-only promotion failed: staging verification does not match the current Release Bundle identity" 1
fi

if ! git cat-file -e "$target_sha^{commit}" >/dev/null 2>&1; then
  git fetch --no-tags origin "$target_sha" --quiet
fi

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

log_info "Verifying current staging candidate $target_sha before tagging $next_tag..."
TARGET_SHA="$target_sha" PROMOTION_EVIDENCE_DIR="$promotion_evidence_dir" \
  bash "$SCRIPT_DIR/verify-production-promotion-ready.sh"

if [ ! -f "$promotion_evidence_dir/release-identity.env" ]; then
  die "Promotion verification did not produce the exact Release Bundle identity" 1
fi
# shellcheck disable=SC1090 # generated by the exact bundle promotion gate
source "$promotion_evidence_dir/release-identity.env"
if [ "$CLASSROOMPATH_SHA" != "$target_sha" ]; then
  die "Release Bundle ClassroomPath SHA $CLASSROOMPATH_SHA does not match staging SHA $target_sha" 1
fi
if [ "$STAGING_RELEASE_ID" != "$RELEASE_ID" ] ||
  [ "$STAGING_RC_RUN_ID" != "$RC_RUN_ID" ] ||
  [ "$STAGING_OPENPATH_SHA" != "$OPENPATH_SHA" ] ||
  [ "$STAGING_OPENPATH_CONTRACT_SHA256" != "$OPENPATH_CONTRACT_SHA256" ]; then
  die "Promotion evidence does not match the exact current staging Release Bundle identity" 1
fi

log_info "Verifying production target readiness before tagging $next_tag..."
bash "$SCRIPT_DIR/preflight-production-promotion-target.sh"

node "$SCRIPT_DIR/promotion-evidence-cli.mjs" write-tag-message \
  --tag "$next_tag" \
  --commit "$target_sha" \
  --release-id "$RELEASE_ID" \
  --rc-run-id "$RC_RUN_ID" \
  --classroompath-sha "$CLASSROOMPATH_SHA" \
  --staging-current "$promotion_evidence_dir/staging-current-images.env" \
  --staging-verification "$promotion_evidence_dir/staging-verification.env" \
  --output "$tag_message_file"

PRODUCTION_TAG_NAME="$next_tag"
PRODUCTION_TAG_TARGET_SHA="$target_sha"
PRODUCTION_TAG_RELEASE_ID="$RELEASE_ID"
PRODUCTION_TAG_RC_RUN_ID="$RC_RUN_ID"
PRODUCTION_TAG_CLASSROOMPATH_SHA="$CLASSROOMPATH_SHA"
production_tag_reconcile_existing

case "$PRODUCTION_TAG_EXISTING_STATE" in
  absent)
    git tag -a "$next_tag" "$target_sha" -F "$tag_message_file"
    log_success "Created production tag $next_tag at $target_sha"
    ;;
  local-only|local-and-remote)
    log_success "Production tag $next_tag already matches the exact Release Bundle identity; idempotent success"
    ;;
  *)
    die "Unknown production tag reconciliation state: ${PRODUCTION_TAG_EXISTING_STATE:-unset}" 1
    ;;
esac

if [ "$PUSH_MODE" = "--local-only" ]; then
  log_info "Skipping push because --local-only was requested"
  exit 0
fi

if [ "$PRODUCTION_TAG_EXISTING_STATE" = "local-and-remote" ]; then
  log_info "Production tag $next_tag is already present on origin; skipping push"
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
