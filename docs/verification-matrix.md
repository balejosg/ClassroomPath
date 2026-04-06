# Verification Matrix

> Status: maintained
> Applies to: ClassroomPath release flow
> Last verified: 2026-03-15
> Source of truth: `docs/verification-matrix.md`

This matrix is optimized for a solo-dev workflow: trust comes from clear evidence, not from duplicating the same checks in slower lanes.

## Verification Lanes

| Lane              | Purpose                                                 | Command / Source                                                      | Blocks release |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| Commit            | Deterministic local confidence before pushing           | `npm run verify:commit` via pre-commit hook                           | Yes            |
| Staging           | Verify the real deployed stack from a developer machine | `npm run deploy:staging`                                              | Yes            |
| Staging evidence  | Persist smoke + release-gate proof for the promoted SHA | `npm run deploy:staging` writes `staging-verification.env` on staging | Yes            |
| Production deploy | Roll out immutable images by tag only                   | `.github/workflows/deploy.yml`                                        | Yes            |
| Production smoke  | Verify the live public stack after deploy               | `tests/smoke.test.ts` in `.github/workflows/deploy.yml`               | Yes            |
| Release evidence  | Publish a transparent summary of what passed            | `release-evidence-<tag>` artifact + job summary                       | No             |

## Risk To Proof Mapping

| Risk                                      | Primary proof                                     | Where it runs                     | Notes                                                                                       |
| ----------------------------------------- | ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| Broken build or type/lint regression      | `verify:commit`                                   | Developer machine                 | Fast local gate; intentionally not duplicated in GitHub Actions                             |
| Regressed browser/UI flow                 | Full Playwright suite in `verify:commit`          | Developer machine                 | Local verification now fails if Playwright browsers are unavailable or any suite is omitted |
| Broken staging deployment                 | `npm run deploy:staging`                          | Developer machine + staging host  | Deploys `origin/main`, runs live smoke, and records staging evidence                        |
| Public auth payload unsafe                | `tests/release-gate.test.ts` via `deploy:staging` | Staging                           | Confirms launch-safe verification URLs and fresh resend tokens once per promoted SHA        |
| Production image mismatch                 | Immutable digest refs in deploy workflow          | GitHub Actions                    | Digests are saved in `release-image-metadata-<tag>`                                         |
| Production deploy drift                   | Tag-only deploy workflow                          | GitHub Actions                    | Production reconciles to the tagged commit only                                             |
| Production stack unavailable after deploy | `tests/smoke.test.ts`                             | GitHub Actions against production | Rollback remains available if smoke fails                                                   |

## Reading Results

- `PASS`: strict smoke verification used the canonical public URL.
- `PASS_WITH_FALLBACK`: staging smoke had to fall back to direct IP / relaxed CORS and should be rerun in strict mode before tagging a release.
- `FAIL`: the lane did not meet the release bar.

## Release-Ready Definition

Treat a release candidate as ready when all of these are true:

1. Local `verify:commit` passed before push.
2. `npm run deploy:staging` exited `0` with `PASS` or a consciously reviewed `PASS_WITH_FALLBACK`.
3. Staging recorded fresh verification evidence for the exact SHA and immutable image digests.
4. The production tag workflow finished with production smoke green.
5. The `release-evidence-<tag>` artifact matches the intended commit, OpenPath SHA, and image digests.
