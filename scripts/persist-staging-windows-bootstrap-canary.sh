#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat >&2 <<'EOF'
Usage: persist-staging-windows-bootstrap-canary.sh

Required environment:
  STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT
  STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA
  STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID
  STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID
  STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE
  STAGING_SSH_KEY

Optional environment:
  STAGING_HOST, STAGING_USER, STAGING_PORT, STAGING_SSH_STRICT_HOSTKEY
EOF
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    usage
    exit 1
  fi
}

for field in \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID \
  STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE \
  STAGING_SSH_KEY
do
  require_env "$field"
done

STAGING_HOST="${STAGING_HOST:-192.168.1.114}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PORT="${STAGING_PORT:-22}"
STAGING_SSH_STRICT_HOSTKEY="${STAGING_SSH_STRICT_HOSTKEY:-no}"
STATE_DIR="${STATE_DIR:-/opt/classroompath/release-state}"
APP_DIR="${APP_DIR:-/opt/classroompath/app}"

STAGING_SSH_KEY="$(expand_tilde "$STAGING_SSH_KEY")"
if [ ! -f "$STAGING_SSH_KEY" ]; then
  echo "Staging SSH key not found: $STAGING_SSH_KEY" >&2
  exit 1
fi

ssh_cmd=(
  ssh
  -F /dev/null
  -o "ConnectTimeout=10"
  -o "BatchMode=yes"
  -o "IdentitiesOnly=yes"
  -o "StrictHostKeyChecking=$STAGING_SSH_STRICT_HOSTKEY"
  -i "$STAGING_SSH_KEY"
  -p "$STAGING_PORT"
  "${STAGING_USER}@${STAGING_HOST}"
)

remote_env_cmd="$(
  remote_assignment STATE_DIR "$STATE_DIR"
  remote_assignment APP_DIR "$APP_DIR"
  remote_assignment STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT "$STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT"
  remote_assignment STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA "$STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA"
  remote_assignment STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID "$STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID"
  remote_assignment STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID "$STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID"
  remote_assignment STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE "$STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE"
)"

"${ssh_cmd[@]}" "${remote_env_cmd}bash -s" <<'REMOTE'
set -euo pipefail

state_file="$STATE_DIR/staging-verification.env"
common_sh="$APP_DIR/scripts/lib/common.sh"
release_state_sh="$APP_DIR/scripts/lib/release-state.sh"

if [ ! -f "$state_file" ]; then
  echo "Staging verification state file not found: $state_file" >&2
  exit 1
fi

if [ -f "$common_sh" ]; then
  # shellcheck disable=SC1090
  source "$common_sh"
fi

if [ ! -f "$release_state_sh" ]; then
  echo "release-state helper not found at $release_state_sh" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$state_file"
# shellcheck disable=SC1090
source "$release_state_sh"

write_staging_verification_state "$state_file"
REMOTE
