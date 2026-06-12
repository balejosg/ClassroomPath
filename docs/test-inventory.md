# ClassroomPath Test Inventory

**Purpose**: Weak-LLM navigation aid. Before editing a workflow or script, run:

```
rg <filename> tests/
```

to find which tests will break. This file maps every test file to the contract it guards.

**Rule**: When you add a test file to `tests/`, add a row to the appropriate category below and update the file count in its section header.

**[ops-contract]** marks files that read `.github/workflows/*.yml` or `scripts/` source text directly. Those tests fail by design when the workflow or script is edited.

How to write new integration tests: see [`docs/runbooks/write-integration-tests.md`](runbooks/write-integration-tests.md).

---

## How to use this document

1. You are about to change `.github/workflows/deploy.yml` -> grep `deploy.yml` in `tests/` -> hits in `workflow-deploy.test.ts`, `ci-cache-measurement.test.ts`, `ci-signal-policy.test.ts`, `ops-contracts.test.ts`.
2. You are about to change `scripts/deploy-staging-local.sh` -> grep that filename -> hits in `deployment-foundation.test.ts`, `deployment-staging-release.test.ts`, `deployment-runtime-contracts.test.ts`, `ops-contracts.test.ts`, `release-risk.test.ts`.
3. You are about to change `scripts/lib/staging-gates.sh` -> hits in `staging-gates.test.ts`.

---

## Category 1: Deploy / Promotion Workflow Contracts

Tests that read `.github/workflows/*.yml` YAML or promotion-related shell scripts. Expect breakage on any workflow or deploy-script edit.

**Files in this category: 8**

| Test file                                                | Lines | Guards                                                                                                                                                                                                                                                                                           | Breaks when                                                                           |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| workflow-config.test.ts                                  | 4     | Barrel re-export: aggregates workflow-core, workflow-deploy, workflow-production-client-canary, workflow-release-candidate                                                                                                                                                                       | Any of those four files break                                                         |
| workflow-core.test.ts [ops-contract]                     | 911   | All `.github/workflows/*.yml`: action version pins, verify-trailers exemptions, Windows DNS restore on checkout, Linux/Windows runner smoke triggers, OpenPath sync workflow, CI change-detector structure, shared cache/setup-node policy                                                       | Workflow YAML edited: action pins change, job names change, trigger conditions change |
| workflow-deploy.test.ts [ops-contract]                   | 1133  | `nightly-staging-candidate.yml`, `deploy.yml`, `promote-current-staging-candidate.yml`, `windows-production-bootstrap-canary.yml`, `reusable-smoke-test.yml`: staging candidate triggers, promotion gate, deploy/smoke shared transport, concurrency helpers                                     | Any deploy/promotion workflow edited                                                  |
| workflow-release-candidate.test.ts [ops-contract]        | 870   | `release-candidate-images.yml`, `firefox-release-assets.yml`, `reusable-release-candidate-image-family.yml`, `scripts/detect-release-candidate-components.sh`, `scripts/fetch-release-candidate-diff-base.sh`: image family jobs, manifest publication gate, Firefox signing, OpenPath sync risk | Release-candidate workflow or component-detector script edited                        |
| workflow-production-client-canary.test.ts [ops-contract] | 2180  | `production-client-update-canary.yml`: signal class, duplicate suppression, probe metadata table, AJAX canary evidence contracts, DNS repair script                                                                                                                                              | Production canary workflow or Windows auto-allow canary logic edited                  |
| deployment-staging-release.test.ts [ops-contract]        | 841   | `scripts/deploy-staging-local.sh` (+lib helpers), `scripts/deploy-staging-remote.sh`, `scripts/check-staging-health.sh`, `scripts/run-staging-release-gate.sh`, `scripts/run-staging-smoke.sh`: staging deploy phases, promotion eligibility, health polling, production tagging sequence        | Any staging/production deploy script edited                                           |
| deployment-runtime-contracts.test.ts [ops-contract]      | 663   | `scripts/run-migrations-image.sh`, `scripts/deploy-staging-local.sh`, `scripts/deploy-staging-remote.sh`, `scripts/lib/common.sh`, staging lib helpers: release image entrypoint, manifest flows, staging/production remote deploy phase order                                                   | Deploy scripts, release image entrypoint, or manifest contract edited                 |
| ops-contracts.test.ts [ops-contract]                     | 63    | `.github/workflows/ci.yml`, `scripts/deploy-staging-local.sh`, `scripts/lib/deploy-payload.sh`: shared test helpers (readProjectText, readProjectWorkflow, shell extraction, ordering) validated against live workflow/script content                                                            | ci.yml or deploy scripts edited; also breaks if test helper API changes               |

---

## Category 2: Release Evidence

Tests over the release evidence model, release state, release-candidate components, risk, and preflight contracts.

**Files in this category: 21**

| Test file                                    | Lines | Guards                                                                                                                                                                                                                                                                                | Breaks when                                                         |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| release-evidence.test.ts                     | 1003  | `scripts/lib/release-evidence.mjs`, `release-evidence-snapshot.mjs`, `release-evidence-contract.mjs`, `scripts/write-release-evidence.mjs`, `scripts/deploy-brief.mjs`: checklist fields, canary artifact names, snapshot serialization, timing policy, promotion readiness interface | Release evidence contract or snapshot shape changes                 |
| release-evidence-bundle.test.ts              | 1218  | `scripts/lib/release-evidence-bundle.mjs`, `scripts/release-evidence-bundle.mjs`: Windows/Linux canary artifact parsing, artifact integrity, production promotion dry-run, bundle CLI                                                                                                 | Canary artifact schema or bundle script changes                     |
| release-state-cli.test.ts                    | 967   | `scripts/release-state-cli.mjs`, `scripts/promotion-evidence-cli.mjs`, `scripts/lib/release-state-contract.mjs`: shell-compatible snapshot, promotion-evidence validation, staging evidence verification, signed Firefox gate, LAN Linux skip policy                                  | Release state contract or promotion evidence CLI changes            |
| release-status.test.ts                       | 711   | `scripts/release-status.mjs`, `scripts/lib/release-status-collector.mjs`, `scripts/lib/release-status-evaluator.mjs`: promotion status summary, OpenPath risk checks, release blockers, operational placeholders                                                                      | Release status script or evaluator logic changes                    |
| release-orchestration.test.ts                | 648   | `scripts/lib/release-orchestration.mjs`, `scripts/release-promote.mjs`: high-risk step order, production deploy/health commands, post-production canary, dry-run non-mutating, prepromotion refresh                                                                                   | Release promotion orchestrator changes                              |
| release-candidate-components.test.ts         | 436   | `scripts/lib/release-candidate-components.mjs`: OpenPath path -> image family mapping, Firefox assets detection, ClassroomPath SPA gateway path                                                                                                                                       | Component mapper logic or path patterns change                      |
| release-candidate-timings.test.ts            | 352   | `scripts/measure-release-candidate-timings.mjs`: RC timing summaries, per-platform evidence, artifact collection                                                                                                                                                                      | Timing measurement script changes                                   |
| deployment-foundation.test.ts [ops-contract] | 454   | `scripts/verify-full.ts`, `scripts/lib/verify-plan.ts`, `scripts/lib/verify-report.ts`, `scripts/lib/verify-cache.ts`, `scripts/lib/verification-catalog.mjs`: migration runner, staging deploy gateway contract, verify-full orchestrator, workspace package contracts               | Verification orchestrator or deploy script structure changes        |
| release-preflight.test.ts                    | 227   | `scripts/lib/release-preflight.mjs`: pre-release read-only checks, dirty checkout block, missing evidence block, package.json script wiring                                                                                                                                           | Release preflight logic or package.json `release:preflight` changes |
| release-risk.test.ts                         | 233   | `scripts/lib/release-risk.mjs`, `scripts/detect-windows-firefox-risk.sh`: changed-file diffing, triple-dot fallback, production-SHA baseline                                                                                                                                          | Risk detection script or diff base logic changes                    |
| release-risk-policy.test.ts                  | 216   | `scripts/lib/release-risk-policy.mjs`, `scripts/lib/migration-risk-classifier.mjs`: canary-triggering paths catalog, platform evidence requirements, email delivery preflight risk                                                                                                    | Risk policy path catalog or migration classifier changes            |
| release-execution.test.ts                    | 259   | `scripts/lib/release-execution.sh`, `scripts/lib/release-state.sh`, `scripts/lib/release-risk-policy.sh`: deploy stage context snapshot, migration risk, destructive migration backup gate, rollback eligibility                                                                      | Release execution or risk policy shell helpers change               |
| release-orchestration.test.ts                | 648   | (already listed above)                                                                                                                                                                                                                                                                | -                                                                   |
| release-images.test.ts                       | 190   | `scripts/release-images.mjs`: GitHub owner/slug parsing, image tag derivation, release-candidate run selection, manifest validation                                                                                                                                                   | Release image helper changes                                        |
| release-manifest.test.ts                     | 50    | `scripts/lib/release-manifest.mjs`: manifest normalization, serialization round-trip                                                                                                                                                                                                  | Manifest contract shape changes                                     |
| release-manifest-platforms.test.ts           | 73    | `scripts/verify-release-manifest-platforms.mjs`: OCI manifest platform validation                                                                                                                                                                                                     | Manifest platform verifier changes                                  |
| release-plan.test.ts                         | 112   | `scripts/lib/release-plan.mjs`: typed release-candidate plan, shell env assignments, source-build fallback                                                                                                                                                                            | Release plan contract changes                                       |
| release-gate.test.ts                         | 99    | tRPC auth.register, auth.generateEmailVerificationToken: launch-safe verification payload                                                                                                                                                                                             | Release gate tRPC contract changes                                  |
| release-gate-client.test.ts                  | 78    | Release gate tRPC client: pinned address, request origin, verification token extraction                                                                                                                                                                                               | Release gate client URL/contract changes                            |
| release-gate-policy.test.ts                  | 136   | Release gate policy: verified email delivery, HTTP LAN origin acceptance, rejection policies                                                                                                                                                                                          | Release gate policy rules change                                    |
| release-cli.test.ts                          | 26    | `scripts/lib/release-cli.mjs`: CLI option parsing, mandatory option enforcement                                                                                                                                                                                                       | CLI helper API changes                                              |
| wait-for-release-candidate.test.ts           | 446   | `scripts/wait-for-release-candidate.mjs`: artifact listing/download, job inspection command, failure/timeout formatting, progress formatting with blockers                                                                                                                            | RC wait script or artifact download contract changes                |
| release-candidate-components.test.ts         | 436   | (already listed above)                                                                                                                                                                                                                                                                | -                                                                   |

---

## Category 3: Runner / Canary Diagnostics

Tests over Windows and Linux canary harnesses, runner diagnostics, and AJAX auto-allow evidence pipelines.

**Files in this category: 18**

| Test file                                     | Lines | Guards                                                                                                                                                                                                                                                                                                                                                                 | Breaks when                                                        |
| --------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| runner-diagnostic.test.ts                     | 1170  | `scripts/lib/github-actions-diagnostic-client.mjs`, `scripts/lib/github-actions-run-timing.mjs`, `scripts/lib/release-wait-summary.mjs`, `scripts/run-runner-diagnostic.mjs`, `scripts/run-windows-ajax-direct.mjs`, `scripts/run-linux-student-diagnostic.mjs`, `scripts/run-linux-ajax-direct.mjs`: timing summary, critical path blockers, package.json entrypoints | Diagnostic client, timing helpers, or package.json scripts change  |
| runner-diagnostic-execution.test.ts           | 372   | `scripts/lib/runner-diagnostic-execution.mjs`: Windows/Linux AJAX diagnostic plan, guest env, file uploads, env var format                                                                                                                                                                                                                                             | Diagnostic execution plan or upload adapter changes                |
| linux-auto-allow-canary.test.ts               | 1068  | `scripts/lib/ajax-auto-allow-canary-harness.mjs`, `scripts/lib/linux-auto-allow-canary-evidence.mjs`, `scripts/linux-ajax-auto-allow-canary.mjs`, `scripts/run-linux-bootstrap-ajax-canary-runtime.sh`: probe table, Firefox DNS flush, extension warmup, declarative diagnostics                                                                                      | Linux canary harness, evidence model, or runtime script changes    |
| linux-ajax-auto-allow-canary.test.ts          | 48    | `scripts/linux-ajax-auto-allow-canary.mjs`: shared AJAX runtime server delegation                                                                                                                                                                                                                                                                                      | Linux AJAX module changes                                          |
| ajax-auto-allow-canary-harness.test.ts        | 446   | `scripts/lib/ajax-auto-allow-canary-harness.mjs`, `scripts/lib/ajax-auto-allow-canary-runtime.mjs`, `scripts/lib/windows-auto-allow-canary-evidence.mjs`: page generation, probe kinds, observer lifecycle, browser open/retry, runtime server lifecycle                                                                                                               | Shared AJAX canary harness or runtime changes                      |
| auto-allow-boundary-evidence.test.ts          | 519   | `scripts/lib/auto-allow-boundary-evidence.mjs`, `scripts/lib/linux-auto-allow-canary-evidence.mjs`, `scripts/lib/windows-auto-allow-canary-evidence.mjs`: declarative boundary engine, phase order, remote rule evidence, artifact summaries                                                                                                                           | Boundary evidence model or platform-specific evidence changes      |
| auto-allow-observation.test.ts                | 54    | `scripts/lib/auto-allow-observation.mjs`: expected-host completion, collector wait                                                                                                                                                                                                                                                                                     | Observation helper changes                                         |
| canary-progress.test.ts                       | 55    | `scripts/lib/canary-progress.mjs`: structured progress log line, elapsed time reporting                                                                                                                                                                                                                                                                                | Canary progress reporter changes                                   |
| windows-ajax-auto-allow-runtime.test.ts       | 262   | `scripts/lib/windows-ajax-auto-allow-runtime.mjs`: env normalization, failure artifact write, resource restore on warmup timeout, Selenium delegation, fast-apply timing, blocked-page unblock subcheck                                                                                                                                                                | Windows AJAX runtime module changes                                |
| windows-ajax-browser-checks.test.ts           | 248   | `scripts/lib/windows-ajax-browser-checks.mjs`: Firefox prefs extension URL discovery, blocked-page evidence, allowlisted navigation, Reddit diagnostic modes                                                                                                                                                                                                           | Windows browser check logic changes                                |
| windows-bootstrap-gate.test.ts                | 750   | `scripts/enrollment-download-canary.mjs`, Windows enrollment scripts (Enroll-Machine.ps1, Pre-Install-Validation.ps1, etc.): tRPC data extraction, rate-limit retry, staging bootstrap endpoints, Firefox artifact availability                                                                                                                                        | Windows enrollment scripts or bootstrap gate tRPC contract changes |
| windows-runner-recovery.test.ts               | 155   | `scripts/lib/windows-runner-recovery.mjs`, `scripts/recover-windows-runner.sh`: Proxmox snapshot selection, runner-offline recommendation, runner-idle queue review, Firefox readiness boundary                                                                                                                                                                        | Windows runner recovery helper changes                             |
| linux-student-evidence-summary.test.ts        | 89    | `scripts/summarize-linux-student-policy-evidence.mjs`: failure boundary outputs, markdown phases, missing artifact handling                                                                                                                                                                                                                                            | Linux student evidence summarizer changes                          |
| prepromotion-runner-rehearsal.test.ts         | 622   | `scripts/lib/prepromotion-runner-rehearsal.mjs`, `scripts/lib/prepromotion-windows-evidence.mjs`: staging evidence reading, rehearsal persistence, run-and-persist, LAN skip acceptance                                                                                                                                                                                | Prepromotion rehearsal logic changes                               |
| production-enrollment-download-canary.test.ts | 279   | `scripts/enrollment-download-canary.mjs`, `scripts/production-enrollment-download-canary.mjs`: Linux/Windows script download, sanitized staging evidence, captive portal domain checks                                                                                                                                                                                 | Enrollment download canary or production wrapper changes           |
| staging-linux-bootstrap-gate.test.ts          | 216   | `scripts/run-staging-linux-bootstrap-gate.mjs`: polling until GH indexes the run, failure on non-index, shell-safe output values                                                                                                                                                                                                                                       | Linux bootstrap gate polling script changes                        |
| failure-brief.test.ts                         | 184   | `scripts/lib/failure-brief.mjs`, `scripts/failure-brief.mjs`: failure boundary classification, retry mapping, artifact-written handling, CLI markdown/JSON output                                                                                                                                                                                                      | Failure brief helper or CLI changes                                |
| resolve-latest-verifier-image.test.ts         | 38    | `scripts/lib/resolve-latest-verifier-image.mjs`, `scripts/wait-for-release-candidate.mjs`: verifier image resolution from RC manifest                                                                                                                                                                                                                                  | Verifier image resolver or manifest shape changes                  |

---

## Category 4: OpenPath Required Checks / Submodule Pins

Tests over OpenPath CI check evaluation, submodule version pins, and Linux agent version resolution.

**Files in this category: 5**

| Test file                            | Lines | Guards                                                                                                                                                                                                             | Breaks when                                                                             |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| openpath-required-checks.test.ts     | 1119  | `scripts/lib/openpath-ci-checks.mjs`, `scripts/openpath-required-checks.mjs`: required check evaluation, CI Success recovery from workflow jobs, Windows Pester job inclusion, corrupt run rerun action, wait mode | Required check names change, CI Success recovery logic changes, or check script changes |
| openpath-linux-agent-version.test.ts | 256   | `scripts/resolve-openpath-linux-agent-version.mjs`: promotion contract URL derivation, APT Packages URL, Linux agent pin verification, APT installability probe, ancestor contract fallback                        | OpenPath Linux agent version resolution script changes                                  |
| openpath-prerelease-recovery.test.ts | 209   | `scripts/lib/openpath-prerelease-recovery.mjs`, `scripts/lib/openpath-ci-checks.mjs`: APT prerelease recovery classification (waiting/rerun_available/blocked/failed/rerun_requested)                              | Prerelease recovery classifier changes                                                  |
| promotion-eligibility.test.ts        | 290   | `scripts/lib/promotion-eligibility.mjs`: promotion eligibility rules (smoke, Windows, Firefox, enrollment, Linux bootstrap), LAN skip acceptance                                                                   | Promotion eligibility policy changes                                                    |
| release-candidate-components.test.ts | 436   | (see Category 2 - also guards OpenPath path -> component mapping)                                                                                                                                                  | OpenPath path patterns for image families change                                        |

---

## Category 5: Gateway / Tenant Behavior

Tests over the tenant group rules, tRPC routing, gateway contracts, and billing setup.

**Files in this category: 7**

| Test file                    | Lines | Guards                                                                                                                                                                    | Breaks when                                                                      |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| tenant-group-rules.test.ts   | 205   | TenantGroupRules: createRule authorization + OpenPath write + publication, bulkCreateRules, updateRule, deleteRule, revokeAutoApproval                                    | Tenant group rule service or OpenPath write contract changes                     |
| stripe-billing-setup.test.ts | 76    | `scripts/setup-stripe-billing.ts`: Stripe catalog from pricing tiers, env output, mode detection                                                                          | Billing setup script or pricing tier structure changes                           |
| smoke.test.ts                | 805   | Live deployment health/API/tRPC/SPA/CORS/security endpoints (all skipped unless SMOKE*TEST_URL is set): /health, /cp/health, /cp/ready, /api/config, /trpc/*, /cp/trpc/\_ | Endpoint paths, response codes, or security headers change in production gateway |
| smoke-trpc-envelope.test.ts  | 81    | `tests/smoke.test.ts` (reads file text), shared tRPC envelope parser: direct/batched success+error parsing                                                                | Smoke test tRPC parsing logic changes                                            |
| release-gate.test.ts         | 99    | (see Category 2)                                                                                                                                                          | -                                                                                |
| release-gate-client.test.ts  | 78    | (see Category 2)                                                                                                                                                          | -                                                                                |
| release-gate-policy.test.ts  | 136   | (see Category 2)                                                                                                                                                          | -                                                                                |

---

## Category 6: CI / CD Signal and Cache Policy

Tests over CI workflow structure, cache measurement, routing measurement, and signal policy.

**Files in this category: 5**

| Test file                                   | Lines | Guards                                                                                                                                                                        | Breaks when                                                          |
| ------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| ci-cache-measurement.test.ts [ops-contract] | 226   | `.github/workflows/ci.yml`, `.github/workflows/reusable-smoke-test.yml`: cache candidate recording, timing report, dependency install policy, cache policy in CI              | ci.yml or reusable-smoke-test.yml edited (cache keys, install steps) |
| ci-routing-measurement.test.ts              | 58    | `scripts/measure-ci-routing.mjs`: CI routing samples for ClassroomPath (scripts/lib/release-candidate-components.mjs, scripts/deploy-production-remote.sh)                    | CI routing measurement script or sampled file paths change           |
| ci-signal-policy.test.ts                    | 341   | `scripts/ci-signal-policy.mjs`: freshness windows, scheduled same-SHA suppression, manual dispatch policy, deploy workflow evidence selectors, multiline output normalization | CI signal policy logic changes                                       |
| ci-workflow-hygiene.test.ts                 | 188   | `scripts/ci-workflow-hygiene.mjs`: stale-run detection, dry-run default, explicit cancel opt-in                                                                               | CI workflow hygiene script changes                                   |
| regression-plan-layout.test.ts              | 40    | `scripts/lib/regression-plan.mjs`: sharded ops suites instead of monolith regression plans                                                                                    | Regression plan layout or sharding changes                           |

---

## Category 7: Deployment Runtime Config / Docker

Tests over docker-compose, Dockerfiles, .env.example, and remote bootstrap scripts.

**Files in this category: 5**

| Test file                                          | Lines | Guards                                                                                                                                                                                                                                                                                                                                                             | Breaks when                                                   |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| deployment-runtime-config.test.ts [ops-contract]   | 492   | `docker-compose.yml`, `Dockerfile.cp-api`, `.env.example`: API/gateway/SPA service config, host.docker.internal gateway, platform pins, OpenPath submodule reference, Windows bootstrap assets, required env vars, email/Linux-agent-pin documentation                                                                                                             | docker-compose.yml, Dockerfile.cp-api, or .env.example edited |
| deployment-docker-tools.test.ts [ops-contract]     | 162   | `scripts/lib/deploy-images.sh`, `scripts/run-migrations-docker.sh`, `scripts/validate-runtime-config-docker.sh`, `scripts/check-email-delivery-docker.sh`, `scripts/run-smoke-in-verifier.sh`: Docker tool helper contracts, tool-image resolution                                                                                                                 | Any of those shell scripts edited                             |
| deployment-remote-bootstrap.test.ts [ops-contract] | 540   | `scripts/lib/remote-bootstrap.sh`, `scripts/lib/remote-deploy-scaffold.sh`, `scripts/lib/remote-helper-contracts.sh`, `scripts/lib/release-manifest.sh`, `scripts/lib/deploy-payload.sh`, `scripts/deploy-staging-remote.sh`, `scripts/deploy-production-remote.sh`: remote helper contracts, script-dir resolution, inline payload alignment, SSH stream recovery | Any remote deploy or bootstrap shell script edited            |
| remote-helper-contracts.test.ts [ops-contract]     | 128   | `scripts/lib/remote-helper-contracts.sh`: versioned helper contract acceptance/rejection logic                                                                                                                                                                                                                                                                     | Remote helper contract version constants change               |
| deployment.test.ts                                 | 3     | Barrel re-export for deployment-foundation, deployment-staging-release, deployment-runtime-contracts                                                                                                                                                                                                                                                               | Any of those three files break                                |

---

## Category 8: Verification Pipeline / Plan / Report

Tests over the typed verification orchestration layer.

**Files in this category: 5**

| Test file                     | Lines | Guards                                                                                                                                                                                     | Breaks when                                                                                                        |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| verification-pipeline.test.ts | 154   | `scripts/lib/verification-catalog.mjs`, `scripts/lib/verification-stage-runners.ts`: catalog pipeline definitions, runner registry completeness, declarative stage order, release/e2e mode | Verification catalog or stage runner registry changes                                                              |
| verify-plan.test.ts           | 211   | `scripts/lib/verify-plan.ts`, `scripts/lib/verify-domain-policy.ts`: release-automation scope detection, ops-regression scope, full verification for product changes, release mode forcing | Verification plan or domain policy patterns change (including `.github/workflows/firefox-release-assets.yml` path) |
| verify-report.test.ts         | 157   | `scripts/lib/verify-report.ts`, `scripts/lib/verify-report-consumer.mjs`, `scripts/lib/verification-report-contract.mjs`: machine-readable report with stage transitions                   | Verify report or contract changes                                                                                  |
| verify-cache.test.ts          | 93    | `scripts/lib/verify-cache.ts`: artifact existence before cache reuse, cache key includes lockfiles and verification inputs                                                                 | Verify cache logic or key composition changes                                                                      |
| verify-runtime.test.ts        | 43    | `scripts/lib/verify-runtime.ts`: cache-confirmed skip of a reported stage                                                                                                                  | Verify runtime stage runner logic changes                                                                          |

---

## Category 9: Firefox Release

Tests over Firefox extension release versioning, metadata, and asset cache.

**Files in this category: 3**

| Test file                            | Lines | Guards                                                                                                                                                                                                                                                            | Breaks when                                                             |
| ------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| firefox-release-assets-cache.test.ts | 345   | `scripts/resolve-firefox-release-assets-cache.mjs`, `scripts/firefox-release-evidence.mjs`: hash/metadata/signature validation, fallback repository, cache miss reasons, evidence classification (cache reuse, fresh signing, AMO manual review, signing timeout) | Firefox asset cache validation or evidence classification logic changes |
| firefox-release-metadata.test.ts     | 80    | `scripts/read-firefox-release-metadata.mjs`: metadata field parsing, required field rejection, CLI field resolution from argv+stdin                                                                                                                               | Firefox metadata helper changes                                         |
| firefox-release-version.test.ts      | 73    | `scripts/lib/firefox-release-version.mjs`: AMO-safe version derivation, leading-zero rejection, manifest file base version, commit timestamp version                                                                                                              | Firefox version helper changes                                          |

---

## Category 10: Misc / Infrastructure / Helpers

Files that do not fit the above categories, including staging gates, git process helpers, docs consistency, and sub-directory tests.

**Files in this category: 26**

| Test file                                    | Lines | Guards                                                                                                                                                                                                                                                        | Breaks when                                                         |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| staging-gates.test.ts [ops-contract]         | 399   | `scripts/lib/staging-gates.sh`, `scripts/run-staging-verification.sh`: canonical npm scripts + results files per gate, gate-owned state fields, smoke push-notification readiness, enrollment download gate, LAN staging detection, resolved address override | staging-gates.sh or run-staging-verification.sh edited              |
| windows-bootstrap-gate.test.ts               | 750   | (see Category 3)                                                                                                                                                                                                                                              | -                                                                   |
| ghcr-preflight.test.ts                       | 202   | `scripts/ghcr-preflight.mjs`, `scripts/lib/ghcr-preflight.mjs`: auth/manifest/network failure classification, GHCR image collection, local/remote preflight, remote login                                                                                     | GHCR preflight script or helper changes                             |
| github-actions-artifacts.test.ts             | 197   | `scripts/lib/github-actions-artifacts.mjs`: pending retry, timeout formatting, progress reporting, archive download through gh stdout                                                                                                                         | GitHub Actions artifact helper changes                              |
| github-actions-health.test.ts                | 328   | `scripts/lib/github-actions-health.mjs`, `scripts/actions-health.mjs`: run health classification (queued/stale/in-progress/terminal), CLI classify/wait/report modes                                                                                          | Actions health classifier or CLI changes                            |
| github-actions-remote.test.ts [ops-contract] | 110   | `scripts/lib/github-actions-remote.sh`: shared shell functions used by deploy and production canary workflows, SSH failure classification, retry logic                                                                                                        | github-actions-remote.sh edited                                     |
| git-process.test.ts                          | 70    | `scripts/lib/git-process.mjs`: sanitizeGitEnv, gitOutput, gitMaybe helpers                                                                                                                                                                                    | Git process helper API changes                                      |
| deploy-intent.test.ts                        | 44    | `scripts/lib/deploy-intent.mjs`: versioned production intent, base64 transport round-trip                                                                                                                                                                     | Deploy intent contract changes                                      |
| deploy-payload.test.ts                       | 60    | `scripts/lib/deploy-payload.mjs`: production deploy payload around manifest contract, base64 transport, source-build staging payload                                                                                                                          | Deploy payload contract changes                                     |
| destructive-runner-guard.test.ts             | 78    | `scripts/lib/destructive-runner-guard.mjs`: active destructive Windows job detection, non-destructive job filtering                                                                                                                                           | Destructive runner guard logic changes                              |
| docs-verification.test.ts                    | 58    | `scripts/lib/regression-plan.mjs`, `scripts/verify-docs.mjs`, package.json `verify:docs` script: maintained ADR index completeness, verify-docs script execution                                                                                              | docs/INDEX.md, ADR list, or verify-docs script changes              |
| agent-docs-consistency.test.ts               | 109   | Reads repo docs (AGENTS.md, etc.): no canonical deploy targets in public guidance, public safeguards documented, placeholder hostnames non-live, no stale duckdns/api/health guidance                                                                         | Public-facing docs or guidance text changes                         |
| npm-audit-critical.test.ts                   | 59    | `scripts/check-npm-audit-critical.mjs`: npm audit report parsing, critical vs high vulnerability classification, corrupt report handling                                                                                                                      | NPM audit critical check script changes                             |
| public-surface-checker.test.ts               | 84    | `scripts/check-public-surface.mjs`: reconstructed-leak blocking (format/join/printf/split tokens), direct public-surface leaks, reserved placeholder allowance                                                                                                | Public surface checker logic changes                                |
| resolved-fetch.test.ts                       | 100   | Resolved fetch helper: explicit-IP connection with canonical host/origin, 204 response handling                                                                                                                                                               | Resolved fetch helper changes                                       |
| resolve-ssh-host.test.ts                     | 49    | `scripts/resolve-ssh-host.sh`: literal IPv4 passthrough, nslookup resolver address exclusion                                                                                                                                                                  | SSH host resolver script changes                                    |
| runtime-environment-policy.test.ts           | 65    | `scripts/lib/runtime-environment-policy.mjs`: billing/Stripe/push modes, self-service org creation, invalid mode rejection                                                                                                                                    | Runtime environment policy catalog changes                          |
| verify-plan.test.ts                          | 211   | (see Category 8)                                                                                                                                                                                                                                              | -                                                                   |
| e2e/fixtures/actors.test.ts                  | 30    | E2E session actor catalog: typed seeded actors, actorToTestUser stripping                                                                                                                                                                                     | Actor fixture schema changes                                        |
| e2e/fixtures/mailbox-providers.test.ts       | 222   | E2E mailbox providers: Mail.tm vs local sink selection, email polling, display-name recipient formatting                                                                                                                                                      | Mailbox provider fixture or E2E_REAL_EMAIL behavior changes         |
| e2e/fixtures/performance-budgets.test.ts     | 21    | E2E performance budgets: internal consistency, batch healthcheck budget                                                                                                                                                                                       | Performance budget constants changes                                |
| e2e/setup/build-artifacts.test.ts            | 89    | E2E build artifact freshness: OpenPath rebuild routing through runner script, stale/fresh detection                                                                                                                                                           | Build artifact freshness logic or `scripts/run-openpath.sh` changes |
| e2e/setup/global-setup.test.ts               | 98    | Playwright global setup: OpenPath API readiness, pre-seed truncate, external BASE_URL skip, local email sink clear                                                                                                                                            | Global setup contract or external URL handling changes              |
| e2e/setup/test-environment.test.ts           | 88    | E2E test environment runner: declarative local execution plan, db:push skip, step execution order                                                                                                                                                             | Test environment runner plan changes                                |
| e2e/setup/worker-runtime.test.ts             | 31    | E2E worker runtime: worker scope metadata derivation, label/local-part prefixing                                                                                                                                                                              | Worker runtime scope logic changes                                  |
| helpers/test-actors.test.ts                  | 65    | Shared test actor helpers: stable tenant defaults, deterministic worker-scoped IDs/emails, seed inventory, runtime-generated orgs                                                                                                                             | Test actor or seed inventory contract changes                       |

---

## Appendix A: api/tests/integration/ (12 files)

These are live API integration tests against a real database. They do NOT read workflow YAML.

| Test file                                                      | Guards                                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| api/tests/integration/billing.integration.test.ts              | Billing tRPC: free self-service block, manual-only mode block, annual checkout, entitlement activation from webhook                            |
| api/tests/integration/classrooms.integration.test.ts           | Classrooms tRPC: list/getById with schedule group, readable group names, enrollment ticket for tenant classrooms                               |
| api/tests/integration/gateway.integration.test.ts              | Gateway integration: API-only mode, unauthenticated 401, refresh token rejection, wrong-issuer rejection                                       |
| api/tests/integration/groups.integration.test.ts               | Groups tRPC: name/slug conflict, cross-org slug isolation, clone rules + templates                                                             |
| api/tests/integration/invitations.integration.test.ts          | Invitations tRPC: user creation delivery metadata, invitation accept end-to-end, existing-user accept                                          |
| api/tests/integration/multi-org-membership.integration.test.ts | Multi-org hardening: billing gate on org creation, cross-org user approval rejection, implicit org selection                                   |
| api/tests/integration/onboarding-policy.integration.test.ts    | Onboarding policy: self-service block in production, directory hiding, invitation-wait fallback                                                |
| api/tests/integration/requests.integration.test.ts             | Requests tRPC: approve creates whitelist rule, root rule for legacy subdomain requests                                                         |
| api/tests/integration/scenario-builder.integration.test.ts     | Integration scenario builder: seedOrgAdmin + seedMember fixtures, standalone actor merge                                                       |
| api/tests/integration/schedules.integration.test.ts            | Schedules tRPC: auth + tenant membership gate, teacher schedule creation scope, cross-teacher readable names, owner-only update/delete         |
| api/tests/integration/tenant-api-harness.integration.test.ts   | Tenant API harness: typed group + classroom fixture creation                                                                                   |
| api/tests/integration/users.integration.test.ts                | Users tRPC: SafeUserWithRoles (no passwordHash), invitation creation without upfront OpenPath user, invitation revocation, email normalization |

---

## Appendix A1: Infrastructure helpers (api/tests/)

These files are not test files themselves but are required by the integration tests above. They live
alongside the integration tests and must NOT be imported after application modules (see ordering
constraints below).

| File                                        | Role                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/tests/helpers/test-env.ts`             | Sets `process.env.JWT_SECRET` and `process.env.NODE_ENV = 'test'` at module-evaluation time. Must be the **first import** of any integration test file. Exports `TEST_JWT_SECRET` (the literal value used as the secret).                                                           |
| `api/tests/integration/harness.ts`          | Exports `signToken` (canonical JWT creation with correct payload shape), `ensureOpenPathUser`, `bootstrapOrg`, `approveOrganizationMember`, `useIntegrationServer` (before/after hook manager), `startIntegrationServer`, `stopIntegrationServer`, and mock OpenPath state helpers. |
| `api/tests/integration/scenario-builder.ts` | Exports `createTenantScenario` -- a factory that wraps harness calls for common multi-entity setups (seedOrgAdmin, seedMember, createGroup, createClassroom, createSchedule).                                                                                                       |
| `api/tests/test-utils.ts`                   | Re-export barrel: `export * from './test-db.js'`, `export * from './test-network.js'`, `export * from './test-trpc.js'`. Keeps import paths stable across the test tree.                                                                                                            |
| `api/tests/test-trpc.ts`                    | Source of `parseTRPC`, `assertStatus`, `bearerAuth`, `trpcQuery`, `trpcMutate`, `TRPCResponse`. These are re-exported through `test-utils.ts`.                                                                                                                                      |
| `api/tests/test-db.ts`                      | Database reset helpers (`resetDb`). Re-exported through `test-utils.ts`.                                                                                                                                                                                                            |
| `api/tests/test-network.ts`                 | Network helpers: `getAvailablePort`, `waitForHealth`. Re-exported through `test-utils.ts`.                                                                                                                                                                                          |

**Import order constraint**: `api/tests/helpers/test-env.ts` must appear before any app or config
import in every integration test file. Importing it after the application singleton loads silently
uses whatever `JWT_SECRET` the process already has, producing auth failures that are hard to trace.

---

## Appendix B: react-spa test locations (50 files)

Unit and component tests live under `react-spa/src/`. They do NOT read workflow YAML. Runner: Vitest (configured in `react-spa/`).

Key directories:

- `react-spa/src/__tests__/` - SPA shell, app entry, SSR entry, brand assets
- `react-spa/src/app/__tests__/` - App state, routing, boot controller/state, shell routing/state, auth entry view, onboarding gate, boot hook
- `react-spa/src/components/__tests__/` - UI components: AdminPanel, BillingStatusBanner, ContactForm, FaqAccordion, FloatingActionButton, GoogleLoginButton, GroupLibrary, PlatformAdminPanel, RevealSection, SharedFooter
- `react-spa/src/components/group-library/__tests__/` - GroupLibraryDialog, RulesPreviewModal, group-library-helpers
- `react-spa/src/constants/__tests__/` - Legal constants
- `react-spa/src/data/__tests__/` - Pricing data, FAQs
- `react-spa/src/i18n/__tests__/` - i18n setup
- `react-spa/src/lib/__tests__/` - auth-storage, cp-trpc, dual-trpc-provider, hooks, reportError, reportErrorSink, session-client-mode
- `react-spa/src/openpath/__tests__/` - OpenPath adapter boundary, public-auth/google/i18n/shell/ui wrappers, roles
- `react-spa/src/pwa/__tests__/` - Service worker, push notification control, register-service-worker
- `react-spa/src/test/__tests__/` - Locale test fixture
- `react-spa/src/utils/__tests__/` - useScrollReveal, validation
- `react-spa/src/views/__tests__/` - DomainRequestsPage

---

## Suspicious flags

Conditional object-style `{ skip: <expr> }` skips found in `tests/smoke.test.ts`. These are runtime-conditional, not static test.skip calls, but they suppress entire describe blocks when `SMOKE_TEST_URL` is unset:

| File                | Line | Pattern                                                                              |
| ------------------- | ---- | ------------------------------------------------------------------------------------ |
| tests/smoke.test.ts | 359  | `void describe('Health Endpoints', { skip: !SMOKE_TEST_URL }, ...)`                  |
| tests/smoke.test.ts | 409  | `void describe('API Endpoints - Path Preservation', { skip: !SMOKE_TEST_URL }, ...)` |
| tests/smoke.test.ts | 460  | `void describe('tRPC Endpoints', { skip: !SMOKE_TEST_URL }, ...)`                    |
| tests/smoke.test.ts | 536  | `void describe('SPA Static Files', { skip: !SMOKE_TEST_URL }, ...)`                  |
| tests/smoke.test.ts | 584  | `void describe('CORS Configuration', { skip: !SMOKE_TEST_URL }, ...)`                |
| tests/smoke.test.ts | 651  | `void describe('Security Headers', { skip: !SMOKE_TEST_URL }, ...)`                  |
| tests/smoke.test.ts | 697  | `void describe('Response Times', { skip: !SMOKE_TEST_URL }, ...)`                    |
| tests/smoke.test.ts | 724  | `{ skip: !SMOKE_TEST_URL \|\| !SMOKE_ALLOW_MUTATIONS }` (mutation describe)          |
| tests/smoke.test.ts | 765  | `void describe('Smoke Test Summary', { skip: !SMOKE_TEST_URL }, ...)`                |

No static `test.skip`, `test.only`, `describe.skip`, or `describe.only` calls were found in any test file under `tests/`.

---

## File count verification

- Root-level `tests/*.test.ts`: **89 files**
- Sub-directory `tests/e2e/**` and `tests/helpers/**`: **8 files** (e2e/fixtures: actors, mailbox-providers, performance-budgets = 3; e2e/setup: build-artifacts, global-setup, test-environment, worker-runtime = 4; helpers: test-actors = 1; total = 8)
- **Total `tests/` tree**: **97 files**
- **Rows in category tables 1-10 (deduplicated)**: 89 root files + 8 subdir files = 97 files catalogued.

Note: `deployment.test.ts` (3 lines) and `workflow-config.test.ts` (4 lines) are pure barrel re-exports with no test cases of their own; they are included in the count and in the tables.
