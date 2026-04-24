# Verification Matrix

> Status: maintained
> Applies to: ClassroomPath verification and release flow
> Last verified: 2026-04-24
> Source of truth: `docs/verification-matrix.md`

This matrix maps the current verification lanes to the evidence they provide.

## Current Local Timing Baseline

Measured on April 19 and April 24, 2026:

- `npm run verify:precommit` completed in `0.168s` with no staged files.
- Commit-hook sample with one staged Markdown file completed in `0.747s`.
- `npm run verify:incremental` completed in `11:28.28` on a warm local tree.
- OpenPath `bash scripts/verify-full.sh` completed in `1:30.35` after sandbox restrictions were removed.
- OpenPath pre-commit with no staged files completed in `0.117s`.

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

gh api repos/balejosg/ClassroomPath/actions/runs/<run-id>/artifacts \
  --jq '.artifacts[] | [.name,.expired,.size_in_bytes,.created_at] | @tsv'
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
2. use OpenPath's GitHub-hosted Windows Pester lane as advisory capacity
   measurement only;
3. promote any hosted Windows lane only after repeated green samples prove it
   does not reduce release confidence;
4. spend optimization effort on the current constraint: Windows queue pressure
   and the longest target-platform jobs, not the already-fast pre-commit hook.

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

| Lane                        | Purpose                                                   | Command / Source                                                                         | Blocks release |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| Commit hook                 | Fast staged-file format and secret checks on commit       | `.husky/pre-commit` -> `npm run verify:precommit`                                        | Yes            |
| Docs verification           | Validate maintained repo-hosted docs before broader lanes | `npm run verify:docs`                                                                    | No             |
| Targeted local verification | Extra manual confidence while iterating                   | selected `node --import tsx --test ...`, `npm run test:deployment`, `npm run test:e2e:*` | No             |
| Staging deploy              | Verify the real deployed staging stack                    | `npm run deploy:staging`                                                                 | Yes            |
| Staging evidence            | Persist smoke and release-gate proof for the promoted SHA | `staging-verification.env` on the staging host                                           | Yes            |
| Production deploy           | Roll out immutable images by tag only                     | `.github/workflows/deploy.yml`                                                           | Yes            |
| Production smoke            | Verify the live public stack after deploy                 | workflow smoke steps against production                                                  | Yes            |
| Release evidence            | Publish a transparent summary of the promoted release     | `release-evidence-<tag>` artifact + workflow summary                                     | No             |

## Risk To Proof Mapping

| Risk                                      | Primary proof                                                                                                                                                     | Where it runs                     | Notes                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Broken build, type, or static regression  | `npm run verify:incremental`, then `npm run verify:commit` for stronger pre-push confidence                                                                       | developer machine                 | commit hook stays fast; broader gates remain explicit               |
| Docs/workflow/runtime drift               | `npm run verify:docs` plus targeted regression suites such as `tests/agent-docs-consistency.test.ts`, `tests/deployment-*.test.ts`, `tests/workflow-core.test.ts` | developer machine or CI           | useful when changes are ops-heavy but not product-heavy             |
| Regressed browser or UI flow              | Playwright lanes chosen by the verification orchestrator                                                                                                          | developer machine                 | product-impacting changes can escalate to the full suite            |
| Broken staging deployment                 | `npm run deploy:staging`                                                                                                                                          | developer machine + staging host  | deploys `origin/main`, runs live verification, and records evidence |
| Unsafe production migration               | migration risk classification + backup reference requirement                                                                                                      | GitHub Actions + production host  | destructive migrations need stronger proof                          |
| Production image mismatch or drift        | tag-only workflow + immutable release manifest                                                                                                                    | GitHub Actions                    | production reconciles to the tagged commit only                     |
| Production stack unavailable after deploy | production smoke and readiness checks                                                                                                                             | GitHub Actions against production | rollback remains available if smoke fails                           |

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
