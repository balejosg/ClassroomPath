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
  - `PRODUCTION_RECOVERY_SHA` — explicit full lowercase recovery-authority SHA; it must differ
    from the selected candidate SHA
  - `PRODUCTION_RECOVERY_SOURCE_ROOT` — independent local checkout at that exact recovery SHA,
    used by the canonical recovery package and no-mutation preflight
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

2. **Inspect the exact RC-first plan (read-only):**

   ```sh
   npm run release:promote -- --rc-run-id <RC_RUN_ID> --auto-tag --dry-run
   ```

   The explicit RC run is the authority for the pre-tag state. The plan resolves its exact
   ClassroomPath/OpenPath/bundle/contract identity, verifies that same candidate in staging, and
   runs the read-only production readiness checks for recovery, configuration, host, and artifacts.
   Readiness checks repository/environment secret names by presence only, uses the configured
   production container platform, executes the recovery helper from the exact candidate commit,
   and applies the same high-risk staging evidence policy selected by the promotion plan.
   The state directory is keyed by `rc-<RC_RUN_ID>`; resume fails closed if any identity changes.

3. **Approve and execute the exact plan:**

   ```sh
   npm run release:promote -- --rc-run-id <RC_RUN_ID> --auto-tag --execute
   ```

   `--execute` is the approval boundary. It creates/pushes one annotated tag only after the exact
   staging and readiness gates pass, then the existing production workflow consumes that tag.
   `--local-only` keeps tag creation local for a reviewed dry integration.

4. **Compatibility wrapper:**

   ```sh
   npm run promote:current-staging
   ```

   This deprecated wrapper resolves only the current staging RC run ID and delegates to the
   canonical `release:promote` command; it owns no identity, readiness, tag, or deploy logic.

**Evidence ladder reminder:** never claim production resolution from staging-only evidence. The
highest completed rung must be `production evidence` or `target-platform symptom cleared` before
reporting production resolution.

The retired aliases `promote:production`, `promote:production:full`, and `release:production` are
no-op deprecation shims: they print this canonical pair and exit 2 without tagging or deploying.

The release-candidate staging path and production path share the same runtime executor for the
mutation boundary, migration, switch, health, readiness, live identity, state activation, terminal
commit, recovery, and ledger semantics. Their adapters keep separate hosts, credentials,
deploy/state roots, URLs, and Compose projects. Live identity validation also verifies the
environment's Compose project label. The legacy staging `source-build` path is a development
compatibility path only; it is not promotion evidence and cannot satisfy the production-readiness
contract.

### Related runbooks

- `docs/runbooks/deploy-staging.md` — staging deploy procedure
- `docs/runbooks/windows-runner-recovery.md` — Windows pre-promotion evidence and runner recovery
