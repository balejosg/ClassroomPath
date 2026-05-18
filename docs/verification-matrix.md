# Verification Matrix

> Status: maintained
> Applies to: ClassroomPath verification and release flow
> Last verified: 2026-05-15
> Source of truth: `docs/verification-matrix.md`

This matrix maps the current verification lanes to the evidence they provide.

## Test Portfolio Baseline

ClassroomPath uses a practical test pyramid with a heavier contract layer than
a typical single-service web app. That is intentional: the SaaS wrapper must
prove tenancy, billing, OpenPath integration, release automation, staging
evidence, and production-promotion contracts before expensive live deployment
checks.

Latest tracked-test inventory, excluding fixtures, snapshots, and the
`upstream/openpath` submodule:

| Component                  |                  Unit | Integration / contract |                                                 E2E |
| -------------------------- | --------------------: | ---------------------: | --------------------------------------------------: |
| API                        | 201 files / 497 cases |   26 files / 174 cases |      Covered by browser E2E where user flow matters |
| React SPA wrapper          |  71 files / 279 cases |                      - | Covered by browser E2E where tenant routing matters |
| Release and ops automation |                     - |   60 files / 327 cases |                                                   - |
| Browser E2E                |                     - |                      - |                                 16 files / 90 cases |

The inventory is file- and case-count based. Treat it as a drift signal, not as
an exact assertion count.

## Component Quality-Speed Policy

Use the cheapest layer that proves the risk:

- API changes should stay unit-first and add integration only for tenancy,
  billing, cross-system mutations, database behavior, OpenPath proxy behavior,
  or gateway wiring. Coverage for changed API files remains the speed-quality
  compromise.
- React SPA wrapper changes should keep most behavior in Vitest tests for
  shell state, routing, auth entry points, OpenPath public-surface consumption,
  and visible component states. Browser E2E should be reserved for flows where
  tenant routing, API state, and user navigation interact.
- Release and ops changes should use contract tests as the primary quality
  layer. Workflow, deploy, release-candidate, canary, and promotion behavior is
  cheaper and more reliable to test as deterministic contracts than by relying
  on staging or production as the first signal.
- Browser E2E should remain small and purposeful: onboarding, auth/email,
  organization management, waiting-room behavior, domain approval, visual
  regression, and performance. Do not add E2E for simple component branches
  that Vitest can cover.
- OpenPath submodule updates should not duplicate all OpenPath verification in
  ClassroomPath. Trust the upstream required checks, then prove the wrapper
  build, release contracts, and any ClassroomPath-specific tenant or deploy
  behavior affected by the new SHA.

Do not expand `.test-allowlist`. It is legacy debt only. When touching an
allowlisted file, add a focused test or route it through an existing contract
suite.

## Current Local Timing Baseline

Measured on April 19, April 24, and April 25, 2026:

- `npm run verify:precommit` completed in `0.168s` with no staged files.
- Commit-hook sample with one staged Markdown file completed in `0.747s`.
- `npm run verify:incremental` completed in `11:28.28` on a warm local tree.
- OpenPath `bash scripts/verify-full.sh` completed in `1:30.35` after sandbox restrictions were removed.
- OpenPath pre-commit with no staged files completed in `0.117s`.
- Current tracked-test distribution is roughly 57% unit, 37% integration or
  contract, and 7% E2E by heuristic case count.

## CI/CD Timing Measurement Method

When optimizing CI/CD, record timing from GitHub workflow evidence, not from
memory or local wall-clock estimates. A future agent should collect:

- ClassroomPath commit SHA and GitHub workflow run ID.
- OpenPath submodule SHA when a run is caused by an upstream update.
- Workflow conclusion and total wall-clock time from `createdAt` to `updatedAt`.
- Per-job durations for `CI`, `Security Scanning`, `Firefox Release Assets`,
  `Release Candidate Images`, deploy, smoke, and client canary jobs when those
  lanes are relevant.
- Whether jobs were skipped, queued, or actually executed.
- Windows runner identity and job timestamps when a lane depends on target
  Windows behavior.
- Cache signals from logs when proposing new cache state.
- Artifact names, sizes, and retained state when evidence artifacts are part of
  the claim.
- Highest completed evidence rung from the workspace evidence ladder.

Useful commands:

```bash
gh run list --repo balejosg/ClassroomPath --branch main --limit 10 \
  --json databaseId,workflowName,headSha,status,conclusion,createdAt,updatedAt

gh run view <run-id> --repo balejosg/ClassroomPath \
  --json name,headSha,status,conclusion,createdAt,updatedAt,jobs

gh run view <run-id> --repo balejosg/ClassroomPath --json name,jobs > jobs.json
node scripts/measure-ci-cache.mjs --jobs-json jobs.json --format markdown

gh api repos/balejosg/ClassroomPath/actions/runs/<run-id>/artifacts \
  --jq '.artifacts[] | [.name,.expired,.size_in_bytes,.created_at] | @tsv'
```

## CI Timing Observability Decision - 2026-05-07

ClassroomPath CI now emits a best-effort `classroompath-ci-timing-measurement`
artifact from the `CI Success` job. The workflow captures raw GitHub Actions job
metadata and a short summary without installing project dependencies in the
summary job.

Use `scripts/measure-ci-cache.mjs` after the run to render the full
observability report from `jobs.json`: discovered `npm ci` steps, successful
per-step timings from GitHub Actions job JSON, turbo/build-backed jobs and
steps, and cache recommendations.

Policy decision:

- Measure first. Do not change cache policy from local estimates or a single CI
  run.
- Do not add Playwright browser cache from this CI timing wave. The current CI
  workflow does not install Playwright browsers directly, and any future
  Playwright cache proposal must include repeated job logs showing a material,
  stable browser download bottleneck.
- Do not add Turbo cache or consolidate `npm ci` lanes until repeated samples
  show the same bottleneck and the change preserves lane-level diagnostic
  value.
- If same-run GitHub job metadata is unavailable, CI may upload a placeholder
  report. Generate the real report after completion:

```bash
gh run view <run-id> --repo balejosg/ClassroomPath --json name,jobs > jobs.json
node scripts/measure-ci-cache.mjs --jobs-json jobs.json --format markdown
```

For OpenPath runner timing after a submodule update, use the maintained
OpenPath runbook:
`https://github.com/balejosg/Openpath/blob/main/docs/ci-cd-runner-measurement.md`.

## Windows Runner Capacity Policy

ClassroomPath release evidence still depends on real target-platform Windows
coverage for Windows/Firefox and client-update canaries. Do not add a second
runner process to the same Windows VM when there is no spare RAM; these canaries
mutate DNS, browser policy, scheduled tasks, services, and installed client
state, so co-locating another destructive runner weakens the evidence instead
of improving throughput.

The current speed plan is:

1. keep production and staging Windows canaries on the pinned self-hosted
   ClassroomPath Windows runner;
2. run at most one destructive Windows job per VM at a time;
3. add Windows capacity only with a separate VM, dedicated labels, cleanup
   policy, and enough RAM to preserve target-platform fidelity;
4. trust OpenPath's required GitHub-hosted Windows Pester lane for short
   upstream unit coverage, but treat it as complementary capacity evidence
   rather than ClassroomPath release proof;
5. keep ClassroomPath Windows release gates on the pinned self-hosted runner
   even when upstream hosted Windows samples stay green;
6. treat runner smoke as health evidence, not functional AJAX, bootstrap, or
   release evidence;
7. spend optimization effort on the current constraint: Windows queue pressure
   and the longest target-platform jobs, not the already-fast pre-commit hook.

Destructive Windows jobs must prove the runner contract before mutating state:
restore DNS before checkout, fail early if another destructive Windows runner
job is active, record runner health before reset, reset OpenPath/browser/DNS
state, record health after reset and after OpenPath install/update, restore DNS
before artifact upload, probe `pipelines.actions.githubusercontent.com`, and
upload `production-windows-runner-health.json` with the functional evidence.
That health artifact is intentionally parseable: runner name/OS, target URL,
target SHA/tag when available, DNS snapshots, artifact endpoint reachability,
OpenPath status summary, and the current failure boundary.

## Latest Submodule Update Evidence

The latest OpenPath runner artifact fix was propagated through ClassroomPath in
commit `e96bc07` (`chore: update openpath submodule for windows artifact upload
fix`), pointing at OpenPath `ecb7a69c`.

Remote evidence for `e96bc07`:

- `CI` run `24761232998`: `success`.
- `Security Scanning` run `24761232984`: `success`.
- `Firefox Release Assets` run `24761232987`: `success`.
- `Release Candidate Images` run `24761232993`: `success`.

## Verification Lanes

Use these lanes in ascending cost order. For development hypotheses, do not jump to staging deploy, production tagging, or broad CI if a cheaper local or runner-directed lane can answer the question first.

The shared workspace wrapper selects the maintained first pass. During development, prefer the direct runner lane; keep GitHub workflow dispatch for integration/deployment time.

- `../scripts/validate-hypothesis.sh classroompath local`
- `../scripts/validate-hypothesis.sh classroompath linux-student-direct`
- `../scripts/validate-hypothesis.sh classroompath windows-bootstrap-gh`
- `../scripts/validate-hypothesis.sh classroompath windows-ajax-direct`

| Lane                            | Purpose                                                                                                   | Command / Source                                                                                                                 | Blocks release |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Commit hook                     | Fast staged-file format and secret checks on commit                                                       | `.husky/pre-commit` -> `npm run verify:precommit`                                                                                | Yes            |
| Docs verification               | Validate maintained repo-hosted docs before broader lanes                                                 | `npm run verify:docs`                                                                                                            | No             |
| Targeted local verification     | Extra manual confidence while iterating                                                                   | selected `node --import tsx --test ...`, `npm run test:deployment`, `npm run test:e2e:*`                                         | No             |
| Direct Linux student diagnostic | Run the OpenPath Linux student-policy lane from ClassroomPath and preserve the `failureBoundary` artifact | `npm run diagnostics:linux-student:direct -- --openpath-root ../OpenPath`                                                        | No             |
| Targeted runner diagnostic      | Check Windows/bootstrap/canary hypotheses without full promotion flow                                     | `npm run diagnostics:windows-ajax:direct`, then `npm run diagnostics:runner` when workflow-shaped evidence is needed             | No             |
| Release status                  | Inspect promotion blockers, staging evidence, OpenPath checks, release-candidate state, and last deploy   | `npm run release:status -- --json`                                                                                               | No             |
| Windows prepromotion evidence   | Inspect or refresh the staging Windows proof required before production tagging                           | `node scripts/prepromotion-windows-evidence.mjs inspect ...` or `node scripts/prepromotion-windows-evidence.mjs run-and-persist` | Yes            |
| Staging deploy                  | Verify the real deployed staging stack                                                                    | `npm run deploy:staging`                                                                                                         | Yes            |
| Staging evidence                | Persist smoke and release-gate proof for the promoted SHA                                                 | `staging-verification.env` on the staging host                                                                                   | Yes            |
| Production deploy               | Roll out immutable images by tag only                                                                     | `.github/workflows/deploy.yml`                                                                                                   | Yes            |
| Production smoke                | Verify the live public stack after deploy                                                                 | workflow smoke steps against production                                                                                          | Yes            |
| Release evidence                | Publish a transparent summary of the promoted release                                                     | `release-evidence-<tag>` artifact + workflow summary                                                                             | No             |

## Current CI/CD Efficiency Controls

- Staging now waits up to `3600s` for the release-candidate manifest by default
  through `STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS`, while the old
  `STAGING_RELEASE_WAIT_TIMEOUT_SECONDS` override remains supported.
- `Release Candidate Images` cancels obsolete push-triggered runs on the same
  ref so a stale RC cannot block the newest SHA from publishing.
- Release-candidate image builds keep stable per-platform GitHub Actions buildx
  cache scopes, and the OpenPath API image now leaves `windows/`,
  `runtime/`, `firefox-extension/`, and `VERSION` out of the expensive
  TypeScript builder stage so bootstrap-only asset churn can reuse the cached
  install/build layers while preserving the final runtime payload and required
  `linux/arm64` production image support.
- Release evidence records the Windows production bootstrap canary result and
  expects the `windows-production-bootstrap-canary` artifact alongside smoke,
  image, staging, and release-evidence bundles.
- OpenPath release-infrastructure-only changes can satisfy the `E2E Summary`
  gate with explicitly skipped target-platform lanes; runtime, product,
  browser, API, shared, installer, and Selenium changes still require the
  relevant OpenPath platform evidence.
- Transactional email provider checks are risk-gated. Staging and production
  run a live Resend preflight for email/auth/onboarding/billing changes or
  forced checks; low-risk deploys record `skipped-low-risk` and keep the
  registration/release gates on reserved test recipients that do not consume
  Resend quota.
- Release hardening commands are diagnostic-first. Use
  `npm run release:status -- --json` to inspect blockers before promotion; use
  `npm --silent run release:status -- --json | jq ...` when piping the JSON.
  `npm run release:promote -- --tag <tag> --dry-run` prints the ordered plan
  without deploying, tagging, waiting for production, or running health checks.
- The promotion orchestrator runs clean-repo checks, release-candidate wait,
  staging deploy, Windows prepromotion evidence, `verify:promotion-ready`,
  production tagging, deploy wait, and production health in order. The default
  plan includes Windows prepromotion evidence; `--no-high-risk-windows` is the
  explicit override for releases where that proof is reviewed as unnecessary.
  `--post-production-windows-canary` appends the post-production Windows client
  canary after production health.
- Staging deploy GHCR preflight classifies auth, missing manifest, and network
  failures before remote mutation. For private GHCR access failures, rerun the
  same deploy command with `STAGING_GHCR_USERNAME=<user>` and
  `STAGING_GHCR_TOKEN="$(gh auth token)"` so the staging host can inspect the
  release-candidate images.
- Production-targeted direct diagnostics require explicit confirmation. Use
  staging by default; only pass `--environment production --confirm-production`
  for a deliberate production diagnostic, with `--base-url` only when the
  target URL override has been reviewed.
- Required-check reports may include stale or corrupt GitHub Actions run
  findings as diagnosis, including suggested `gh run view` or `gh run rerun`
  commands. Those findings explain the failure boundary; they do not by
  themselves replace the required check result.

## Release Timing Update - 2026-04-29

Change:

- Production release evidence now prints the active wait blocker, and
  release-candidate image builds keep stable per-platform GitHub Actions buildx
  cache scopes while the OpenPath API builder excludes `windows/`, `runtime/`,
  `firefox-extension/`, and `VERSION` from the expensive TypeScript builder
  stage.

Before:

- Deploy run `25086257302`: `Deploy to Production` queue `102s`, execution
  `109s`; `Linux Production Bootstrap Canary` queue `221s`, execution `284s`;
  `Windows Production Bootstrap Canary` queue `214s`, execution `229s`;
  `Release Evidence` queue `507s`, execution `6s`.

After:

- Deploy run `25099916175`: `Deploy to Production` queue `112s`, execution
  `153s`; `Linux Production Bootstrap Canary` queue `274s`, execution `291s`;
  `Windows Production Bootstrap Canary` queue `269s`, execution `230s`;
  `Release Evidence` queue `568s`, execution `7s`.
- Latest `measure-release-candidate-timings.mjs` samples still show queue and
  runner availability dominating more often than image-family execution:
  repeated gate candidate `migrations arm64` across `2` samples with max family
  duration `75s`, while longer `gateway arm64` (`236s`) and `openpathApi
arm64` (`151s`) samples did not repeat enough to justify another cache-policy
  change yet.

Policy:

- Inspect queue versus execution plus release-candidate timing before changing
  release gates again.
- Treat upstream hosted Windows Pester as complementary OpenPath capacity
  evidence, not as a replacement for ClassroomPath self-hosted Windows canaries.

## Pipeline Speed Baseline - 2026-05-01

Current evidence:

- Deploy run `25214295571` for ClassroomPath
  `658378aa7fcf6aed9f6189d66f9af0cadbcc91aa` succeeded in `8m15s`
  wall-clock. The timing summary separated queue from execution: `Deploy to
Production` queue `121s`, execution `56s`; `Smoke Test Production` queue
  `179s`, execution `43s`; `Linux Production Bootstrap Canary` queue `181s`,
  execution `295s`; `Windows Production Bootstrap Canary` queue `179s`,
  execution `200s`; `Release Evidence` queue `485s`, execution `10s`.
- The critical path ended at `Release Evidence`. The largest execution segment
  was the Linux bootstrap canary, while the largest wait segment was queue time
  before `Release Evidence`.
- Latest `measure-release-candidate-timings.mjs latest --repo
balejosg/ClassroomPath --limit 3` samples repeated `migrations arm64` as the
  gate candidate across runs `25213451900`, `25213221158`, and `25212890496`,
  with family durations `57s`, `55s`, and `68s`.

Decision:

- Keep release wait and canary observability informational first. The repeated
  RC gate is short enough that the next speed work should stay focused on
  queue/runner availability before changing cache policy.
- Do not change `.github/actions/build-release-candidate-image/action.yml` from
  this sample alone. The plan requires repeated timing and a material cache
  surface before altering release-candidate cache behavior.

## Risk To Proof Mapping

| Risk                                          | Primary proof                                                                                                                                                     | Where it runs                                     | Notes                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Broken build, type, or static regression      | `npm run verify:incremental`, then `npm run verify:commit` for stronger pre-push confidence                                                                       | developer machine                                 | commit hook stays fast; broader gates remain explicit               |
| Docs/workflow/runtime drift                   | `npm run verify:docs` plus targeted regression suites such as `tests/agent-docs-consistency.test.ts`, `tests/deployment-*.test.ts`, `tests/workflow-core.test.ts` | developer machine or CI                           | useful when changes are ops-heavy but not product-heavy             |
| Regressed browser or UI flow                  | Playwright lanes chosen by the verification orchestrator                                                                                                          | developer machine                                 | product-impacting changes can escalate to the full suite            |
| Runner-bound Linux student-policy symptom     | `npm run diagnostics:linux-student:direct -- --openpath-root ../OpenPath`                                                                                         | developer machine + local OpenPath Linux runner   | preserves `linux-auto-allow-boundary.json` before staging/CI        |
| Runner-bound Windows/bootstrap/canary symptom | `npm run diagnostics:windows-ajax:direct`, then `npm run diagnostics:runner -- --suite windows-bootstrap-ajax ...`                                                | developer machine + runner VM / targeted workflow | use before staging deploy when the question is runner-local         |
| Broken staging deployment                     | `npm run deploy:staging`                                                                                                                                          | developer machine + staging host                  | deploys `origin/main`, runs live verification, and records evidence |
| Unsafe production migration                   | migration risk classification + backup reference requirement                                                                                                      | GitHub Actions + production host                  | destructive migrations need stronger proof                          |
| Production image mismatch or drift            | tag-only workflow + immutable release manifest                                                                                                                    | GitHub Actions                                    | production reconciles to the tagged commit only                     |
| Production stack unavailable after deploy     | production smoke and readiness checks                                                                                                                             | GitHub Actions against production                 | rollback remains available if smoke fails                           |

Use direct Windows diagnostics first when the question is packaging, runner
state, Firefox policy, native-host behavior, or AJAX auto-allow behavior. Use
`workflow_dispatch` only when the question needs workflow-shaped integration
evidence, and use staging/production release workflows only after local or
direct runner evidence has narrowed the failure boundary.

When promotion readiness fails on Windows evidence, inspect before rerunning the
full release flow:

```bash
node scripts/prepromotion-windows-evidence.mjs inspect \
  --staging-host staging-host.example.invalid
```

If the output says evidence is required or stale for the staged SHA, refresh and
persist it:

```bash
node scripts/prepromotion-windows-evidence.mjs run-and-persist \
  --openpath-root ../OpenPath
```

Then rerun `npm run verify:promotion-ready` or the promotion dry run. If a
GitHub Actions run appears stuck, classify it before retrying broad workflows:

```bash
node scripts/actions-health.mjs classify \
  --repo balejosg/ClassroomPath \
  --run-id <run-id>
```

## Reading Results

- `PASS`: strict smoke verification used the canonical public URL
- `PASS_WITH_FALLBACK`: staging smoke needed direct-IP or relaxed-CORS fallback and should be rerun in strict mode before production tagging when possible
- `FAIL`: the lane did not meet the release bar

## Release-Ready Definition

Treat a release candidate as ready when all of these are true:

1. local commit verification passed before push
2. `npm run deploy:staging` exited `0` with `PASS` or a consciously reviewed `PASS_WITH_FALLBACK`
3. staging recorded fresh verification evidence for the exact promoted SHA
4. the production tag workflow finished with production smoke green
5. the `release-evidence-<tag>` artifact matches the intended ClassroomPath SHA, OpenPath SHA, and image refs
