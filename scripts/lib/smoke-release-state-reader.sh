#!/usr/bin/env bash
# Build and run the exact remote reader used by the Smoke Tests workflow.
# The rendered command embeds this payload so the remote host needs Bash, but
# does not need a checkout or a preinstalled copy of this helper.

# BEGIN REMOTE PAYLOAD
smoke_release_state_fail() {
  local marker="$1"
  local exit_code="$2"

  printf 'SMOKE_RELEASE_STATE_ERROR=%s\n' "$marker" >&2
  exit "$exit_code"
}

smoke_release_state_read() {
  local state_root="${1:-}"
  local current_file=""
  local pointer=""
  local pointer_bytes=""
  local runtime_file=""
  local runtime_text=""

  [ -n "$state_root" ] || smoke_release_state_fail current-missing-or-empty 40
  current_file="${state_root%/}/current"
  [ -e "$current_file" ] || smoke_release_state_fail current-missing-or-empty 40
  [ -f "$current_file" ] || smoke_release_state_fail current-unreadable 41
  [ -s "$current_file" ] || smoke_release_state_fail current-missing-or-empty 40
  [ -r "$current_file" ] || smoke_release_state_fail current-unreadable 41

  pointer_bytes="$(LC_ALL=C wc -c < "$current_file" 2>/dev/null)" ||
    smoke_release_state_fail current-unreadable 41
  [ "$pointer_bytes" = 65 ] || smoke_release_state_fail pointer-invalid 42
  IFS= read -r pointer < "$current_file" 2>/dev/null ||
    smoke_release_state_fail pointer-invalid 42
  [[ "$pointer" =~ ^[0-9a-f]{64}$ ]] || smoke_release_state_fail pointer-invalid 42

  runtime_file="${state_root%/}/releases/$pointer/runtime.env"
  [ -e "$runtime_file" ] || smoke_release_state_fail runtime-state-missing 43
  [ -f "$runtime_file" ] || smoke_release_state_fail runtime-state-unreadable 44
  [ -s "$runtime_file" ] || smoke_release_state_fail runtime-state-missing 43
  [ -r "$runtime_file" ] || smoke_release_state_fail runtime-state-unreadable 44
  runtime_text="$(cat "$runtime_file" 2>/dev/null)" ||
    smoke_release_state_fail runtime-state-unreadable 44

  printf 'POINTER_RELEASE_ID=%s\n' "$pointer"
  printf '%s\n' "$runtime_text"
}
# END REMOTE PAYLOAD

smoke_release_state_shell_quote() {
  local value="$1"
  printf "'%s'" "${value//\'/\'\\\'\'}"
}

smoke_release_state_render_remote_command() {
  local state_root="$1"
  local helper_path="${BASH_SOURCE[0]}"
  local payload=""
  local quoted_root=""

  payload="$(sed -n '/^# BEGIN REMOTE PAYLOAD$/,/^# END REMOTE PAYLOAD$/p' "$helper_path" | sed '1d;$d')"
  [ -n "$payload" ] || {
    printf 'Unable to render smoke release-state reader payload\n' >&2
    return 1
  }
  quoted_root="$(smoke_release_state_shell_quote "$state_root")"

  printf "bash -s -- %s <<'CLASSROOMPATH_SMOKE_RELEASE_STATE_READER'\n" "$quoted_root"
  printf '%s\n' "$payload"
  printf '%s\n' 'smoke_release_state_read "$1"'
  printf '%s\n' 'CLASSROOMPATH_SMOKE_RELEASE_STATE_READER'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    render)
      [ "$#" -eq 2 ] || {
        printf 'Usage: %s render <state-root>\n' "$0" >&2
        exit 2
      }
      smoke_release_state_render_remote_command "$2"
      ;;
    *)
      printf 'Usage: %s render <state-root>\n' "$0" >&2
      exit 2
      ;;
  esac
fi
