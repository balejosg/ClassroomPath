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
require_cmd bash
require_cmd node

usage() {
  cat <<'EOF'
Usage: bash scripts/tag-production-release.sh <tag> --rc-run-id <id> --candidate-sha <sha> --release-id <id> --openpath-sha <sha> --contract-sha256 <sha> --bundle-file <file> --contract-file <file> --staging-current <file> --staging-verification <file> [--local-only]

Creates one annotated production tag for the exact RC identity already verified
by release:promote. This adapter owns tag reconciliation only; readiness is
revalidated through the canonical production-readiness operation.

Examples:
  bash scripts/tag-production-release.sh v1.2.120 --rc-run-id 34124312483 \\
    --candidate-sha <sha> --release-id <id> --openpath-sha <sha> \\
    --contract-sha256 <sha> --bundle-file <file> --contract-file <file> \\
    --staging-current <file> --staging-verification <file>
EOF
}

TAG_NAME="${1:-}"
shift || true
PUSH_MODE=""
EXPECTED_RC_RUN_ID=""
EXPECTED_CANDIDATE_SHA=""
EXPECTED_RELEASE_ID=""
EXPECTED_OPENPATH_SHA=""
EXPECTED_CONTRACT_SHA256=""
BUNDLE_FILE=""
CONTRACT_FILE=""
STAGING_CURRENT_FILE=""
STAGING_VERIFICATION_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --local-only)
      PUSH_MODE="--local-only"
      shift
      ;;
    --rc-run-id)
      [ "$#" -ge 2 ] || die "--rc-run-id requires a value" 1
      EXPECTED_RC_RUN_ID="$2"
      shift 2
      ;;
    --candidate-sha)
      [ "$#" -ge 2 ] || die "--candidate-sha requires a value" 1
      EXPECTED_CANDIDATE_SHA="$2"
      shift 2
      ;;
    --release-id)
      [ "$#" -ge 2 ] || die "--release-id requires a value" 1
      EXPECTED_RELEASE_ID="$2"
      shift 2
      ;;
    --openpath-sha)
      [ "$#" -ge 2 ] || die "--openpath-sha requires a value" 1
      EXPECTED_OPENPATH_SHA="$2"
      shift 2
      ;;
    --contract-sha256)
      [ "$#" -ge 2 ] || die "--contract-sha256 requires a value" 1
      EXPECTED_CONTRACT_SHA256="$2"
      shift 2
      ;;
    --bundle-file)
      [ "$#" -ge 2 ] || die "--bundle-file requires a value" 1
      BUNDLE_FILE="$2"
      shift 2
      ;;
    --contract-file)
      [ "$#" -ge 2 ] || die "--contract-file requires a value" 1
      CONTRACT_FILE="$2"
      shift 2
      ;;
    --staging-current)
      [ "$#" -ge 2 ] || die "--staging-current requires a value" 1
      STAGING_CURRENT_FILE="$2"
      shift 2
      ;;
    --staging-verification)
      [ "$#" -ge 2 ] || die "--staging-verification requires a value" 1
      STAGING_VERIFICATION_FILE="$2"
      shift 2
      ;;
    *)
      usage
      die "Unsupported option: $1" 1
      ;;
  esac
done

if [ -z "$TAG_NAME" ]; then
  usage
  die "Missing required tag argument" 1
fi

if [[ ! "$TAG_NAME" =~ ^v[0-9]+(\.[0-9]+){2,}$ ]]; then
  die "Production tag must look like v<major>.<minor>.<patch>" 1
fi

if [ -z "$EXPECTED_RC_RUN_ID" ] || [[ ! "$EXPECTED_RC_RUN_ID" =~ ^[0-9]+$ ]]; then
  die "--rc-run-id must be a numeric GitHub workflow run id" 1
fi

if [[ ! "$EXPECTED_CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  die "--candidate-sha must be a full lowercase 40-character SHA" 1
fi
if [[ ! "$EXPECTED_RELEASE_ID" =~ ^[0-9a-f]{64}$ ]]; then
  die "--release-id must be a full lowercase 64-character SHA-256" 1
fi
if [[ ! "$EXPECTED_OPENPATH_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  die "--openpath-sha must be a full lowercase 40-character SHA" 1
fi
if [[ ! "$EXPECTED_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  die "--contract-sha256 must be a full lowercase 64-character SHA-256" 1
fi

for required_file in "$BUNDLE_FILE" "$CONTRACT_FILE" "$STAGING_CURRENT_FILE" "$STAGING_VERIFICATION_FILE"; do
  [ -f "$required_file" ] || die "Required exact promotion file is missing: ${required_file:-unset}" 1
done

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

current_sha="$(git rev-parse HEAD)"
if [ "$current_sha" != "$EXPECTED_CANDIDATE_SHA" ]; then
  die "HEAD $current_sha does not match the exact candidate SHA $EXPECTED_CANDIDATE_SHA" 1
fi

release_fence_id="$EXPECTED_RELEASE_ID"
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
  if [ "$fence_sha" != "$EXPECTED_CANDIDATE_SHA" ]; then
    die "Release fence SHA $fence_sha does not match candidate $EXPECTED_CANDIDATE_SHA" 1
  fi
  release_fence_id="$(resolve_active_release_fence_id "$fence_json" "$EXPECTED_CANDIDATE_SHA")"
  if [ -z "$release_fence_id" ]; then
    die "Release fence must resolve to a release id for candidate $EXPECTED_CANDIDATE_SHA" 1
  fi
  if [ "$release_fence_id" != "$EXPECTED_RELEASE_ID" ]; then
    die "Release fence release id does not match the exact Release Bundle release id" 1
  fi
fi

tag_message_file="$(mktemp)"
cleanup() {
  rm -f "$tag_message_file"
}
trap cleanup EXIT

read_state_value() {
  local state_path="$1"
  local key="$2"
  awk -F= -v expected_key="$key" '$1 == expected_key { print substr($0, index($0, "=") + 1); exit }' "$state_path"
}

current_candidate_sha="$(read_state_value "$STAGING_CURRENT_FILE" APP_SHA)"
current_release_id="$(read_state_value "$STAGING_CURRENT_FILE" RELEASE_ID)"
current_rc_run_id="$(read_state_value "$STAGING_CURRENT_FILE" RC_RUN_ID)"
current_openpath_sha="$(read_state_value "$STAGING_CURRENT_FILE" OPENPATH_SHA)"
current_contract_sha256="$(read_state_value "$STAGING_CURRENT_FILE" OPENPATH_CONTRACT_SHA256)"
current_image_source="$(read_state_value "$STAGING_CURRENT_FILE" IMAGE_SOURCE)"
verified_candidate_sha="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFIED_APP_SHA)"
verified_release_id="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFIED_RELEASE_ID)"
verified_rc_run_id="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFIED_RC_RUN_ID)"
verified_openpath_sha="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFIED_OPENPATH_SHA)"
verified_contract_sha256="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFIED_OPENPATH_CONTRACT_SHA256)"
verified_image_source="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFIED_IMAGE_SOURCE)"
verification_state="$(read_state_value "$STAGING_VERIFICATION_FILE" STAGING_VERIFICATION_STATE)"

if [ "$current_candidate_sha" != "$EXPECTED_CANDIDATE_SHA" ] ||
  [ "$verified_candidate_sha" != "$EXPECTED_CANDIDATE_SHA" ]; then
  die "Staging evidence does not match the exact candidate SHA" 1
fi
if [ "$current_release_id" != "$EXPECTED_RELEASE_ID" ] ||
  [ "$verified_release_id" != "$EXPECTED_RELEASE_ID" ]; then
  die "Staging evidence does not match the exact release id" 1
fi
if [ "$current_rc_run_id" != "$EXPECTED_RC_RUN_ID" ] ||
  [ "$verified_rc_run_id" != "$EXPECTED_RC_RUN_ID" ]; then
  die "Staging evidence does not match the exact RC run id" 1
fi
if [ "$current_openpath_sha" != "$EXPECTED_OPENPATH_SHA" ] ||
  [ "$verified_openpath_sha" != "$EXPECTED_OPENPATH_SHA" ]; then
  die "Staging evidence does not match the exact OpenPath SHA" 1
fi
if [ "$current_contract_sha256" != "$EXPECTED_CONTRACT_SHA256" ] ||
  [ "$verified_contract_sha256" != "$EXPECTED_CONTRACT_SHA256" ]; then
  die "Staging evidence does not match the exact OpenPath contract hash" 1
fi
if [ "$current_image_source" != "release-candidate" ] ||
  [ "$verified_image_source" != "release-candidate" ] ||
  [ "$verification_state" != "success" ]; then
  die "Staging evidence is not a successful release-candidate verification" 1
fi

contract_sha256="$(sha256sum "$CONTRACT_FILE" | awk '{print $1}')"
if [ "$contract_sha256" != "$EXPECTED_CONTRACT_SHA256" ]; then
  die "OpenPath contract bytes do not match the exact contract identity" 1
fi

node scripts/release-bundle.mjs verify \
  --bundle-file "$BUNDLE_FILE" \
  --contract-file "$CONTRACT_FILE" \
  --release-id "$EXPECTED_RELEASE_ID" \
  --classroompath-sha "$EXPECTED_CANDIDATE_SHA" \
  --openpath-sha "$EXPECTED_OPENPATH_SHA" >/dev/null

log_info "Revalidating canonical production readiness before tagging $TAG_NAME..."
ensure_github_token_env
if ! node scripts/production-readiness.mjs \
  --rc-run-id "$EXPECTED_RC_RUN_ID" \
  --candidate-sha "$EXPECTED_CANDIDATE_SHA" \
  --release-id "$EXPECTED_RELEASE_ID" \
  --openpath-sha "$EXPECTED_OPENPATH_SHA" \
  --contract-sha256 "$EXPECTED_CONTRACT_SHA256" \
  --bundle-file "$BUNDLE_FILE" \
  --contract-file "$CONTRACT_FILE" \
  --json >/dev/null; then
  die "Canonical production readiness no longer passes for the exact RC identity" 1
fi

# The CLI writes the complete immutable identity and the staging evidence block.
node scripts/promotion-evidence-cli.mjs write-tag-message \
  --tag "$TAG_NAME" \
  --commit "$EXPECTED_CANDIDATE_SHA" \
  --release-id "$EXPECTED_RELEASE_ID" \
  --rc-run-id "$EXPECTED_RC_RUN_ID" \
  --classroompath-sha "$EXPECTED_CANDIDATE_SHA" \
  --openpath-sha "$EXPECTED_OPENPATH_SHA" \
  --contract-sha256 "$EXPECTED_CONTRACT_SHA256" \
  --staging-current "$STAGING_CURRENT_FILE" \
  --staging-verification "$STAGING_VERIFICATION_FILE" \
  --output "$tag_message_file"

PRODUCTION_TAG_NAME="$TAG_NAME"
PRODUCTION_TAG_TARGET_SHA="$EXPECTED_CANDIDATE_SHA"
PRODUCTION_TAG_RELEASE_ID="$EXPECTED_RELEASE_ID"
PRODUCTION_TAG_RC_RUN_ID="$EXPECTED_RC_RUN_ID"
PRODUCTION_TAG_CLASSROOMPATH_SHA="$EXPECTED_CANDIDATE_SHA"
PRODUCTION_TAG_OPENPATH_SHA="$EXPECTED_OPENPATH_SHA"
PRODUCTION_TAG_CONTRACT_SHA256="$EXPECTED_CONTRACT_SHA256"
export PRODUCTION_TAG_NAME PRODUCTION_TAG_TARGET_SHA PRODUCTION_TAG_RELEASE_ID
export PRODUCTION_TAG_RC_RUN_ID PRODUCTION_TAG_CLASSROOMPATH_SHA
export PRODUCTION_TAG_OPENPATH_SHA PRODUCTION_TAG_CONTRACT_SHA256
production_tag_reconcile_existing

case "$PRODUCTION_TAG_EXISTING_STATE" in
  absent)
    git tag -a "$TAG_NAME" "$EXPECTED_CANDIDATE_SHA" -F "$tag_message_file"
    log_success "Created production tag $TAG_NAME at $EXPECTED_CANDIDATE_SHA"
    ;;
  local-only|local-and-remote)
    log_success "Production tag $TAG_NAME already matches the exact Release Bundle identity; idempotent success"
    ;;
  *)
    die "Unknown production tag reconciliation state: ${PRODUCTION_TAG_EXISTING_STATE:-unset}" 1
    ;;
esac

if [ -f "$WORKSPACE_GUARD" ]; then
  python3 "$WORKSPACE_GUARD" release-mark-tagged --release-id "$release_fence_id" --tag "$TAG_NAME"
fi

if [ "$PUSH_MODE" = "--local-only" ]; then
  log_info "Skipping push because --local-only was requested"
  exit 0
fi

if [ "$PRODUCTION_TAG_EXISTING_STATE" = "local-and-remote" ]; then
  log_info "Production tag $TAG_NAME is already present on origin; skipping push"
  exit 0
fi

if [ -n "${PROMOTION_TAG_PUSH_TOKEN:-}" ]; then
  require_cmd base64
  log_info "Pushing production tag $TAG_NAME with the configured promotion token"
  promotion_remote_path="$(git config --get remote.origin.url | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##')"
  promotion_tag_push_header="$(printf 'x-access-token:%s' "$PROMOTION_TAG_PUSH_TOKEN" | base64 | tr -d '\n')"
  git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $promotion_tag_push_header" \
    push "https://github.com/$promotion_remote_path.git" \
    "refs/tags/$TAG_NAME"
else
  git push origin "$TAG_NAME"
fi
log_success "Pushed production tag $TAG_NAME to origin"
