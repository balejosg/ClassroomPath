#!/usr/bin/env bash
#
# linux-runner-maintenance.sh — Reclaim disk space on the Linux CI controller host.
#
# Problem: The Linux controller VM (which hosts the CI runner) can fill its disk to 100%,
# causing CI jobs to hang at setup-node or other cache steps. This script prunes unused
# Docker images, containers, and volumes to free space.
#
# Run this script directly on the affected Linux controller host — it does NOT SSH anywhere.
# Disk-fill events happen inside that VM; the fix is applied locally there.
#
# Usage:
#   bash scripts/linux-runner-maintenance.sh [--dry-run] [--yes]
#
# Flags:
#   --dry-run   Print the prune command instead of running it.
#   --yes       Skip the interactive confirmation prompt.
#
# Optional env (set in .env.local or export):
#   DISK_FREE_MIN_GB   Minimum free gigabytes before prompting to prune. Default: 10

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

usage() {
  cat <<'EOF'
Usage: bash scripts/linux-runner-maintenance.sh [--dry-run] [--yes]

Reclaims disk space on the local Linux CI controller by running
`docker system prune -af --volumes`, which removes ALL unused images,
containers, build cache, and volumes. This is destructive — only unused
resources are removed, but that includes any locally cached Docker images.

Run this script directly on the Linux controller host (no SSH needed).

Flags:
  --dry-run   Print the prune command instead of running it.
  --yes       Skip the interactive confirmation prompt.

Optional env (default shown):
  DISK_FREE_MIN_GB     10   (minimum free GB; if above threshold, script
                             still runs but warns the disk looks healthy)
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

DISK_FREE_MIN_GB="${DISK_FREE_MIN_GB:-10}"

require_cmd docker
require_cmd df

log_info "=== Disk status BEFORE maintenance ==="
df -h .

# Determine available space on the current filesystem (in GB)
avail_kb="$(df --output=avail . | tail -1 | tr -d ' ')"
avail_gb=$(( avail_kb / 1024 / 1024 ))

log_info "Available disk space: ${avail_gb} GB (threshold: ${DISK_FREE_MIN_GB} GB)"

if [ "$avail_gb" -ge "$DISK_FREE_MIN_GB" ]; then
  log_warn "Disk looks healthy (${avail_gb} GB free >= ${DISK_FREE_MIN_GB} GB threshold)."
  if [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -eq 0 ]; then
    if ! confirm_with_timeout "Disk appears healthy. Run docker prune anyway?" 30; then
      log_info "Skipping prune — disk has sufficient free space."
      exit 0
    fi
  fi
fi

log_warn "WARNING: docker system prune -af --volumes removes ALL unused images,"
log_warn "containers, build cache, and volumes on this host. This is DESTRUCTIVE."
log_warn "Only run this on the CI controller host when disk fill is blocking CI."

if [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  if ! confirm_with_timeout "Run docker system prune -af --volumes?" 30; then
    log_warn "Aborted by operator."
    exit 0
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log_info "[dry-run] docker system prune -af --volumes"
  log_success "Dry-run complete. No commands were executed."
  exit 0
fi

log_info "Running: docker system prune -af --volumes"
docker system prune -af --volumes

log_info ""
log_info "=== Disk status AFTER maintenance ==="
df -h .

log_success "Linux runner maintenance complete."
