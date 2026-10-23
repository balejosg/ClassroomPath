# Public Note: Windows Runner Recovery

> Status: public stub
> Applies to: ClassroomPath public repository surface
> Source of truth: `docs/runbooks/windows-runner-recovery.md`

Windows runner recovery procedures cover two recurring infrastructure failure modes. The scripts
that fix them live in `scripts/` and require private operator values supplied via `.env.local` at
runtime. No hostnames, VM identifiers, snapshot names, SSH users, or key paths are committed to
this repository.

Public reviewers should treat runner and canary workflows as release-signal automation. Private
infrastructure values are intentionally not published in this source-available repository.

## Failure Mode 1: Stale Proxmox Lock (VM Unreachable After Interrupted Rollback)

**Symptom:** A snapshot rollback was interrupted by a broken pipe. Subsequent `qm` commands on the
Windows runner VM return a lock error and the runner does not come back online.

**Script:** `scripts/proxmox-windows-runner-reset.sh`

This script:

1. Connects to the Proxmox node over SSH using a host alias you supply.
2. Clears the stale VM lock (`qm unlock`), tolerating the case where no lock exists.
3. Rolls the VM back to its baseline snapshot (`qm rollback`).
4. Starts the VM (`qm start`).
5. Calls `scripts/recover-windows-runner.mjs status` to verify runner re-registration.

**Setup:** Add the following to your `.env.local` (never commit this file):

```
PROXMOX_SSH_ALIAS=<your-proxmox-ssh-host-alias>
WINDOWS_RUNNER_VMID=<your-vm-id>
WINDOWS_RUNNER_BASELINE_SNAPSHOT=<your-snapshot-name>
```

`WINDOWS_RUNNER_VMID` is required and must be numeric. The other two have generic defaults that will
fail to connect until overridden with real values.

**Usage:**

```bash
# Preview what the script will do (no SSH, no side effects):
bash scripts/proxmox-windows-runner-reset.sh --dry-run

# Run interactively (prompts for confirmation):
bash scripts/proxmox-windows-runner-reset.sh

# Run non-interactively (CI or operator scripting):
bash scripts/proxmox-windows-runner-reset.sh --yes
```

SSH keepalive options (`ServerAliveInterval=15`, `ServerAliveCountMax=4`) are set on the SSH
command to avoid the same broken-pipe failure mode that caused the original stale lock.

## Failure Mode 2: Linux Controller Disk Full (CI Hangs at setup-node)

**Symptom:** The Linux controller VM that hosts the CI runner fills its disk to 100%. CI jobs
hang or fail at `setup-node`, `npm ci`, or Docker build steps. `df -h` on the controller shows
0 bytes available.

**Script:** `scripts/linux-runner-maintenance.sh`

This script runs **locally on the affected Linux controller host** — no SSH needed. It:

1. Prints current disk usage (`df -h`) before any action.
2. Checks free space against a configurable threshold (`DISK_FREE_MIN_GB`, default 10 GB).
3. Warns that `docker system prune -af --volumes` is destructive (removes all unused images,
   containers, build cache, and volumes).
4. Prompts for confirmation (skippable with `--yes`).
5. Runs the prune if confirmed.
6. Prints disk usage again after the prune.

**Setup:** No private values are required. Optionally set in `.env.local`:

```
DISK_FREE_MIN_GB=10
```

**Usage (run directly on the controller host):**

```bash
# Preview what will happen (no docker commands run):
bash scripts/linux-runner-maintenance.sh --dry-run

# Run interactively (prompts for confirmation):
bash scripts/linux-runner-maintenance.sh

# Run non-interactively:
bash scripts/linux-runner-maintenance.sh --yes
```

**Note:** The prune is intentionally aggressive to recover disk space quickly during a CI
outage. It removes all unused Docker resources, including cached layers. CI will rebuild caches
on the next run, which may be slower than usual.

## After Recovery

After either failure mode is resolved, verify that the Windows runner appears online in the
repository's Actions runner list before re-queuing blocked jobs. Use
`scripts/recover-windows-runner.mjs status` to check runner state via the GitHub API.

## Canary Reset, Auto-Start and Failure Classes

- The persistent Windows canary state reset is a single versioned script,
  `scripts/windows-runner-reset.ps1`, shared by the production bootstrap and client-update
  canaries. Each sub-step is isolated (a hung Acrylic uninstaller is killed after a timeout,
  `sc.exe delete` tolerates already-removed services, residual AppLocker policy is cleared with
  an empty policy when the OpenPath AppControl module is gone). Residue that cannot be removed
  emits `OPENPATH_RUNNER_RESET_INFRA_FAILURE` and `failure_class=infra`.
- The production bootstrap canary reports `failure_class` (`infra` or `product`). In `deploy.yml`
  an `infra` failure triggers one canary retry before `rollback-production` may run; a `product`
  failure, or an exhausted retry, still rolls back.
- The `actions.runner.*` services must be `Automatic` (Delayed) with service recovery set, so a
  VM reboot brings the runner back online without manual intervention. Check this after any
  runner reinstall.
- `scripts/windows-runner-ensure-services.ps1` (idempotent, per-service try/catch) applies this
  with `sc.exe config <svc> start= delayed-auto` and
  `sc.exe failure <svc> reset= 86400 actions= restart/60000/...`. The Self-Hosted Windows Runner
  Smoke workflow runs it on every smoke (every 30 minutes), so a reinstalled runner is repaired
  automatically; run it manually in an elevated shell after a reinstall (`-Strict` exits 1 on failure).
- `production-readiness` (config check) now also requires every runner in
  `CLASSROOMPATH_WINDOWS_RUNNER_NAME` to be online in the GitHub runners API, and blocks with
  `CONFIG_BLOCKER` naming the offline/unregistered runner otherwise.
