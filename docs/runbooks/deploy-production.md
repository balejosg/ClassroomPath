# Public Note: Production Deployment

> Status: public stub
> Applies to: ClassroomPath public repository surface
> Source of truth: `docs/runbooks/deploy-production.md`

ClassroomPath production deployment runbooks are operational material and are maintained privately.
They may include host details, deployment credentials, release promotion internals, recovery paths,
backup procedures, health endpoints, and production verification evidence.

The public repository intentionally does not document production deployment commands or live targets.
Current-file cleanup does not remove historical exposure from git history, workflow logs, artifacts,
releases, packages, or public issues; those surfaces require separate review.

ClassroomPath remains source-available for review and local private evaluation only. Production use,
institutional self-hosting, SaaS resale, redistribution, white-labeling, or hosted replicas require
written permission.

---

## Local production promotion (operator workstation)

Production promotion is executed on the operator workstation, not by CI. CI runners intentionally
lack the operator-private config required to reach production targets. This section documents what
must be in place before running a promotion and which commands to use.

### Prerequisites

Run `npm run verify:operator-config` first to check `.env.local` for missing or placeholder
operator vars in one pass, before starting a promotion attempt.

**Private config files (untracked, never committed):**

- `.env.local` — operator-private environment variables. Required keys:
  - `CLASSROOMPATH_DEPLOY_ROOT` — local root for deploy state
  - `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY` — staging SSH access for promotion evidence
  - `DEPLOY_HOST`, `DEPLOY_USER` — production target (optional; auto-derived from
    `config/deploy-targets.local.json` when omitted)
  - `WINDOWS_RUNNER_VMID`, `PROXMOX_SSH_ALIAS` — required for Windows pre-promotion evidence
- `config/deploy-targets.local.json` — private deploy targets. Create from
  `config/deploy-targets.example.json` (`.invalid` placeholders) and fill in real values. This file
  must remain untracked.

**Submodule prerequisite:**

`upstream/openpath` must be on branch `main` at the gitlink SHA recorded in the index, or the
orchestrator's `verify-clean-repos` step will fail. When the local HEAD already equals
`origin/main`, `scripts/ensure-openpath-submodule-on-main.sh` (invoked automatically by the
orchestrator) will auto-position the submodule. If the local HEAD diverges, resolve it manually
before starting promotion. See `docs/runbooks/update-openpath-submodule.md` for the submodule
update flow.

### Promotion command sequence

1. **Inspect promotion state (advisory):**

   ```sh
   npm run release:status
   ```

   Read-only; shows current release and submodule state.

2. **Run the authoritative readiness gate (blocking):**

   ```sh
   npm run verify:promotion-ready
   ```

   This gate is blocking. If it exits non-zero, promotion must not proceed. There is no bypass.
   The gate checks that staging is promotion-eligible, submodule state is clean, and required
   evidence is present.

3. **Promote (auto-derives next patch tag, runs production preflight, pushes tag):**

   ```sh
   npm run promote:current-staging
   ```

   Alternatively, run the fuller orchestrated sequence (dry-run by default; add `--execute` to
   perform real operations):

   ```sh
   npm run release:promote -- --execute
   ```

**Evidence ladder reminder:** never claim production resolution from staging-only evidence. The
highest completed rung must be `production evidence` or `target-platform symptom cleared` before
reporting production resolution.

### Related runbooks

- `docs/runbooks/deploy-staging.md` — staging deploy procedure
- `docs/runbooks/windows-runner-recovery.md` — Windows pre-promotion evidence and runner recovery
