#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd ssh
require_cmd npm

usage() {
  cat <<'EOF'
Usage: bash scripts/promote-current-staging-candidate.sh [--local-only]

Resolve only the exact RC currently active and verified on staging, then
delegate the complete promotion to the canonical RC-first release:promote
orchestrator. --local-only keeps the canonical tag step local for rehearsal.
EOF
}

local_only=0
for arg in "$@"; do
  case "$arg" in
    --local-only) local_only=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage; die "Unsupported option: $arg" 2 ;;
  esac
done

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
current_state_file="$(mktemp)"
verification_state_file="$(mktemp)"
cleanup() {
  rm -f "$current_state_file" "$verification_state_file"
}
trap cleanup EXIT

SSH_CMD=(
  ssh
  -F "$STAGING_SSH_CONFIG"
  -o ConnectTimeout=10
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o "StrictHostKeyChecking=$STAGING_SSH_STRICT_HOSTKEY"
  -i "$STAGING_SSH_KEY"
  -p "$STAGING_PORT"
  "${STAGING_USER}@${STAGING_HOST}"
)

"${SSH_CMD[@]}" "cat /srv/classroompath/release-state/current-images.env" > "$current_state_file"
"${SSH_CMD[@]}" "cat /srv/classroompath/release-state/staging-verification.env" > "$verification_state_file"

read_env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$file"
}

rc_run_id="$(read_env_value "$current_state_file" RC_RUN_ID)"
rc_run_id="${rc_run_id:-$(read_env_value "$current_state_file" STAGING_RELEASE_RUN_ID)}"
verified_state="$(read_env_value "$verification_state_file" STAGING_VERIFICATION_STATE)"
verified_source="$(read_env_value "$verification_state_file" STAGING_VERIFIED_IMAGE_SOURCE)"
verified_rc_run_id="$(read_env_value "$verification_state_file" STAGING_VERIFIED_RC_RUN_ID)"
verified_rc_run_id="${verified_rc_run_id:-$(read_env_value "$verification_state_file" RC_RUN_ID)}"

[[ "$rc_run_id" =~ ^[0-9]+$ ]] || die "Staging current-images.env has no exact RC run ID" 1
[ "$verified_state" = success ] ||
  die "Staging verification state=${verified_state:-unset}; expected success" 1
[ "$verified_source" = release-candidate ] ||
  die "Staging verified image source=${verified_source:-unset}; expected release-candidate" 1
[ "$rc_run_id" = "$verified_rc_run_id" ] ||
  die "Staging RC run ID does not match the verified staging RC" 1

promotion_args=(--rc-run-id "$rc_run_id" --auto-tag --execute)
if [ "$local_only" -eq 1 ]; then
  promotion_args+=(--local-only)
fi

exec npm run release:promote -- "${promotion_args[@]}"
