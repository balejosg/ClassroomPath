#!/usr/bin/env bash
#
# proxmox-windows-runner-reset.sh — Recover a stale-locked or crashed Windows CI runner VM.
#
# Problem: After a Proxmox snapshot rollback interrupted by a broken pipe, a stale qm lock
# can block all subsequent qm commands on the VM. This script clears that lock, rolls the VM
# back to a known-good snapshot, starts it, then re-registers the runner via
# scripts/recover-windows-runner.mjs.
#
# Usage:
#   bash scripts/proxmox-windows-runner-reset.sh [--dry-run] [--yes]
#
# Flags:
#   --dry-run   Print each command instead of running it; never contacts Proxmox or Node.
#   --yes       Skip the interactive confirmation prompt.
#
# Required env (set in .env.local):
#   WINDOWS_RUNNER_VMID                  — Proxmox VM ID (numeric, e.g. 103). REQUIRED.
#
# Optional env (set in .env.local or export):
#   PROXMOX_SSH_ALIAS                    — SSH host alias for the Proxmox node.
#                                          Default: proxmox-host.example.invalid
#   WINDOWS_RUNNER_BASELINE_SNAPSHOT     — Snapshot name to roll back to.
#                                          Default: baseline

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
Usage: bash scripts/proxmox-windows-runner-reset.sh [--dry-run] [--yes]

Clears a stale Proxmox qm lock, rolls the Windows runner VM back to its
baseline snapshot, starts it, and re-registers the GitHub Actions runner.

Flags:
  --dry-run   Print commands instead of running them (no SSH, no node).
  --yes       Skip the interactive confirmation prompt.

Required env (set in .env.local):
  WINDOWS_RUNNER_VMID                  Proxmox VM ID (numeric). REQUIRED.

Optional env (default shown):
  PROXMOX_SSH_ALIAS                    proxmox-host.example.invalid
  WINDOWS_RUNNER_BASELINE_SNAPSHOT     baseline
EOF
}

DRY_RUN=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --yes)      ASSUME_YES=1 ;;
    --help|-h)  usage; exit 0 ;;
    *)          usage; die "Unknown option: $arg" 2 ;;
  esac
done

ENV_LOCAL="$PROJECT_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  load_env_file "$ENV_LOCAL" || true
fi

PROXMOX_SSH_ALIAS="${PROXMOX_SSH_ALIAS:-proxmox-host.example.invalid}"
WINDOWS_RUNNER_BASELINE_SNAPSHOT="${WINDOWS_RUNNER_BASELINE_SNAPSHOT:-baseline}"
VMID="${WINDOWS_RUNNER_VMID:-}"

if [ -z "$VMID" ]; then
  die "WINDOWS_RUNNER_VMID is not set. Add it to .env.local: WINDOWS_RUNNER_VMID=<your-vm-id>"
fi

if ! [[ "$VMID" =~ ^[0-9]+$ ]]; then
  die "WINDOWS_RUNNER_VMID must be numeric (got: $VMID). Check your .env.local."
fi

require_cmd ssh
if [ "$DRY_RUN" -eq 0 ]; then
  require_cmd node
fi

log_info "Windows runner VM reset"
log_info "  Proxmox SSH alias : $PROXMOX_SSH_ALIAS"
log_info "  VM ID             : $VMID"
log_info "  Snapshot          : $WINDOWS_RUNNER_BASELINE_SNAPSHOT"
if [ "$DRY_RUN" -eq 1 ]; then
  log_warn "  Mode              : DRY RUN (no commands will be executed)"
fi

if [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  if ! confirm_with_timeout "This will rollback VM $VMID to snapshot '$WINDOWS_RUNNER_BASELINE_SNAPSHOT'. Continue?" 30; then
    log_warn "Aborted by operator."
    exit 0
  fi
fi

SSH_CMD=(
  ssh
  -o "ServerAliveInterval=15"
  -o "ServerAliveCountMax=4"
  -o "BatchMode=yes"
  -o "ConnectTimeout=15"
  "$PROXMOX_SSH_ALIAS"
)

run_remote() {
  local desc="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] ${SSH_CMD[*]} $*"
  else
    log_info "$desc"
    "${SSH_CMD[@]}" "$@"
  fi
}

run_local() {
  local desc="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    log_info "[dry-run] $*"
  else
    log_info "$desc"
    "$@"
  fi
}

# Step a: unlock — tolerate failure in case the VM was not locked
log_info "Step 1/4: Clearing any stale qm lock on VM $VMID ..."
if [ "$DRY_RUN" -eq 1 ]; then
  log_info "[dry-run] ${SSH_CMD[*]} qm unlock $VMID"
else
  if "${SSH_CMD[@]}" "qm unlock $VMID" 2>&1; then
    log_success "qm unlock succeeded (or was a no-op)."
  else
    log_warn "qm unlock returned non-zero — VM may not have been locked. Continuing."
  fi
fi

# Step b: rollback to the baseline snapshot
run_remote "Step 2/4: Rolling back VM $VMID to snapshot '$WINDOWS_RUNNER_BASELINE_SNAPSHOT' ..." \
  "qm rollback $VMID $WINDOWS_RUNNER_BASELINE_SNAPSHOT"

# Step c: start the VM
run_remote "Step 3/4: Starting VM $VMID ..." \
  "qm start $VMID"

# Step d: re-register the GitHub Actions runner
run_local "Step 4/4: Re-registering the GitHub Actions runner ..." \
  node "$SCRIPT_DIR/recover-windows-runner.mjs" status

if [ "$DRY_RUN" -eq 1 ]; then
  log_success "Dry-run complete. No commands were executed."
else
  log_success "Windows runner VM reset complete."
  log_info "If the runner does not appear online within ~5 minutes, run:"
  log_info "  node scripts/recover-windows-runner.mjs status"
  log_info "  node scripts/recover-windows-runner.mjs recommend"
fi
