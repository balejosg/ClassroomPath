## Context

The first `2026-04-08` release-automation refactor split verification planning/stages, extracted shared GitHub Actions helpers, and moved Firefox release version logic behind a library boundary. The follow-up refactor in `49a093b` then completed the next layer:

- `scripts/release-images.mjs` and `scripts/wait-for-release-candidate.mjs` are now thin CLIs over `scripts/lib/release-images.mjs` and `scripts/lib/release-candidate.mjs`.
- `scripts/lib/verify-plan.ts` now models release-automation eligibility through explicit domains/capabilities instead of a flat allowlist.
- `tests/helpers/release-fixtures.ts` now exposes scenario builders instead of raw fixture-path reads.
- `scripts/lib/verify-report.ts` now emits a machine-readable verification report that `scripts/verify-full.ts` updates during execution.
- `scripts/lib/regression-plan.mjs` now centralizes the regression-suite selection used by `scripts/run-ci-regression.mjs`.

## High-ROI Follow-Ups

1. Push the CLI/lib boundary into the remaining release helpers.
   `scripts/resolve-latest-verifier-image.mjs` still contains its own `gh` I/O, artifact download flow, and output shaping. It should consume `scripts/lib/release-images.mjs` and `scripts/lib/release-candidate.mjs` the same way the other release CLIs now do.

2. Make verification domains data-driven from package ownership metadata.
   `scripts/lib/verify-plan.ts` is much better now, but the domains are still hand-authored regexes. The next step is to describe ownership/capabilities from package or folder metadata so the verification policy does not drift as the repo grows.

3. Reuse the machine-readable verification report in developer tooling and CI.
   `scripts/lib/verify-report.ts` currently writes the JSON contract, but nothing outside `verify-full.ts` consumes it yet. Hooks, GitHub Actions summaries, and deployment gates should read the same report instead of re-inferring status from console logs.

4. Add richer release scenario builders.
   The current scenario builders centralize fixture selection, but they still load mostly static canned payloads. The next ROI step is a tiny builder DSL that can generate variations like "latest run pending", "artifact missing after success", or "summary check recovered from jobs" without cloning fixture JSON.

5. Memoize regression-plan resolution per process.
   `scripts/lib/regression-plan.mjs` is now the source of truth, but every caller still resolves the plan independently. Caching or precomputing the flattened plan once per process would remove redundant work and give us one place to expose metadata such as "safe for commit lane" or "requires sanitized env".
