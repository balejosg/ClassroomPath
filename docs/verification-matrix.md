# Verification Matrix

> Status: maintained
> Applies to: ClassroomPath verification and release flow
> Last verified: 2026-04-13
> Source of truth: `docs/verification-matrix.md`

This matrix maps the current verification lanes to the evidence they provide.

## Verification Lanes

| Lane                        | Purpose                                                   | Command / Source                                                                         | Blocks release |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| Commit hook                 | Deterministic local confidence on commit                  | `.husky/pre-commit` -> `npm run verify:commit`                                           | Yes            |
| Targeted local verification | Extra manual confidence while iterating                   | selected `node --import tsx --test ...`, `npm run test:deployment`, `npm run test:e2e:*` | No             |
| Staging deploy              | Verify the real deployed staging stack                    | `npm run deploy:staging`                                                                 | Yes            |
| Staging evidence            | Persist smoke and release-gate proof for the promoted SHA | `staging-verification.env` on the staging host                                           | Yes            |
| Production deploy           | Roll out immutable images by tag only                     | `.github/workflows/deploy.yml`                                                           | Yes            |
| Production smoke            | Verify the live public stack after deploy                 | workflow smoke steps against production                                                  | Yes            |
| Release evidence            | Publish a transparent summary of the promoted release     | `release-evidence-<tag>` artifact + workflow summary                                     | No             |

## Risk To Proof Mapping

| Risk                                      | Primary proof                                                                                                                          | Where it runs                     | Notes                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Broken build, type, or static regression  | `npm run verify:commit`                                                                                                                | developer machine                 | commit hook is the default gate                                     |
| Docs/workflow/runtime drift               | targeted regression suites such as `tests/agent-docs-consistency.test.ts`, `tests/deployment-*.test.ts`, `tests/workflow-core.test.ts` | developer machine or CI           | useful when changes are ops-heavy but not product-heavy             |
| Regressed browser or UI flow              | Playwright lanes chosen by the verification orchestrator                                                                               | developer machine                 | product-impacting changes can escalate to the full suite            |
| Broken staging deployment                 | `npm run deploy:staging`                                                                                                               | developer machine + staging host  | deploys `origin/main`, runs live verification, and records evidence |
| Unsafe production migration               | migration risk classification + backup reference requirement                                                                           | GitHub Actions + production host  | destructive migrations need stronger proof                          |
| Production image mismatch or drift        | tag-only workflow + immutable release manifest                                                                                         | GitHub Actions                    | production reconciles to the tagged commit only                     |
| Production stack unavailable after deploy | production smoke and readiness checks                                                                                                  | GitHub Actions against production | rollback remains available if smoke fails                           |

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
