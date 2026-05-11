# Windows Runner Recovery Runbook

> Status: maintained
> Applies to: `classroompath-windows-103`
> Evidence rung: target-platform runner health
> Last verified: 2026-05-11
> Source of truth: `docs/runbooks/windows-runner-recovery.md`

Use this runbook when Windows canaries queue, stall, or fail in a way that could
come from persistent runner state. Do not debug Firefox, OpenPath, enrollment, or
AJAX behavior until the runner has a fresh health artifact.

Canonical helper:

```bash
scripts/recover-windows-runner.sh status
scripts/recover-windows-runner.sh recommend --artifact production-windows-bootstrap-canary.json
```

Set `WINDOWS_RUNNER_RECOVERY_DRY_RUN=1` to print commands without mutating
GitHub Actions or the Proxmox VM.

## Recovery Ladder

1. Capture state before changing anything.

   ```bash
   gh run view <run-id> --repo balejosg/ClassroomPath --json databaseId,status,conclusion,jobs
   scripts/recover-windows-runner.sh status
   ssh whitelist-proxmox qm status 103
   ssh whitelist-proxmox qm listsnapshot 103
   ssh whitelist-proxmox qm config 103
   ```

   Record the GitHub runner `status` and `busy` fields, queued or in-progress
   Windows jobs, VM power state, snapshot list, and `boot: order=sata0`.

2. If GitHub reports `classroompath-windows-103` as `offline` but Proxmox says
   VM `103` is `running`, inspect the VM console or screenshot first. Treat this
   as runner/VM/network state until proven otherwise.

3. If a clean baseline snapshot exists, prefer snapshot rollback over a long
   manual repair session.

   Baseline snapshots should use a stable name and clear description, for
   example `snapshot-clean-baseline-YYYYMMDD` with `clean baseline before lab`
   or `pre-bypass clean baseline` in the description.

4. Restore the baseline only when no legitimate destructive Windows job is
   running on the runner.

   ```bash
   scripts/recover-windows-runner.sh restore \
     --snapshot snapshot-clean-baseline-YYYYMMDD \
     --confirm
   ```

   The helper runs:

   ```bash
   ssh whitelist-proxmox qm rollback 103 <snapshot>
   ssh whitelist-proxmox qm set 103 --boot order=sata0
   ssh whitelist-proxmox qm start 103
   ```

   Then it waits for `classroompath-windows-103` to become `online` and
   `busy=false`.

5. Cancel obsolete queue blockers only after preserving the target run.

   ```bash
   scripts/recover-windows-runner.sh unblock-queue --run <target-run-id> --confirm
   ```

   This command is intentionally narrow: it only considers known Windows runner
   workflows and never cancels the target run passed with `--run`.

6. Run smoke before product debugging.

   ```bash
   npm run diagnostics:runner -- \
     --suite runner-smoke \
     --check-runner-state \
     --wait \
     --download-artifacts
   ```

   Confirm the smoke artifact and runner state show `online` and `busy=false`.

7. Only investigate product or canary behavior after runner health is clean.
   The Windows bootstrap canary should upload `production-windows-runner-health.json`
   together with the functional artifact. If DNS before/after evidence is present
   and `artifactEndpoint.reachable` is healthy, treat a concrete canary boundary
   such as `firefox-extension-ready` as a product/canary failure, not as runner
   recovery work.

## Operational Policy

- Do not register a second destructive runner inside VM `103`.
- Do not debug Firefox/OpenPath behavior until
  `production-windows-runner-health.json` exists for the failing canary or the
  runner smoke is green.
- Keep a clean baseline snapshot with a stable name and explicit description.
- After destructive labs, restore the clean snapshot and run the runner smoke.
- The runner smoke proves runner health only. It does not validate AJAX,
  bootstrap, staging, or production release behavior.
- Do not repeat the nightly or production-like canary until the upstream
  OpenPath `E2E Summary` is terminal and runner smoke is green.
