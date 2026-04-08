## Context

The `2026-04-08` release-automation refactor split verification planning/stages, extracted shared GitHub Actions helpers, and moved Firefox release version logic behind a library boundary. This reduced coupling, but it also made the next cleanup seams more explicit.

## High-ROI Follow-Ups

1. Split the remaining release CLIs into thin wrappers plus pure libraries.
   `scripts/release-images.mjs` and `scripts/wait-for-release-candidate.mjs` are cleaner now because they consume `scripts/lib/github-actions.mjs`, but they still mix argument parsing, GitHub I/O, formatting, and policy. Extracting `scripts/lib/release-images.mjs` and `scripts/lib/release-candidate.mjs` would make them easier to test without subprocess scaffolding.

2. Replace glob-only release-automation detection with ownership-aware verification policy.
   `scripts/lib/verify-plan.ts` currently uses a conservative allowlist of release/workflow paths. The next step is to model verification policy by domain ownership so future changes under `scripts/` or `tests/` can opt into fast verification based on explicit capabilities instead of filename patterns.

3. Consolidate release fixtures into scenario builders.
   The new fixtures under `tests/fixtures/release/` removed duplication, but the tests still hand-pick JSON files per suite. A small scenario-builder layer can express cases such as "latest success", "candidate still running", or "CI recovery required" without scattering fixture selection across tests.

4. Add a single machine-readable verification report.
   `scripts/lib/verify-stages.ts` now centralizes stage execution, but the verification outcome is still primarily human-formatted console output. Emitting a compact JSON report would let hooks, CI, and release scripts consume the same result contract without parsing logs.

5. Cache release-automation test selection.
   `scripts/run-ci-regression.mjs` now exposes dedicated test groups. The next step is to derive and cache the selected regression set once per run so `verify:commit`, CI helpers, and local scripts do not each rebuild that selection logic independently.
