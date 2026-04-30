# Linux Reddit Diagnostics Design

## Goal

Extend the Linux AJAX auto-allow canary so its artifact includes Reddit-specific diagnostics in the same shape already used by the Windows canary. This keeps Linux release evidence compatible with the existing bundle/parser/reporting pipeline while preserving the current Linux auto-allow probe and failure-boundary behavior.

## Scope

In scope:

- `scripts/linux-ajax-auto-allow-canary.mjs`
- `scripts/lib/release-evidence-bundle.mjs`
- focused tests covering Linux canary output and Linux artifact parsing

Out of scope:

- changing OpenPath behavior
- broad workflow or staging changes
- introducing a Linux-only Reddit artifact contract

## Design

### Shared Reddit Contract

The Linux canary will reuse the existing Windows Reddit diagnostic host list and probe definitions:

- `REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS`
- `REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES`

Linux will emit `artifact.redditDiagnostics` with the same top-level shape used by Windows:

- `phase`
- `collectedAt`
- `hosts`
- `probes`
- `page`
- `whitelist`
- `server`

The Linux artifact will not create a parallel Linux-specific schema.

### Linux Evidence Collection

`scripts/linux-ajax-auto-allow-canary.mjs` will add a small Reddit diagnostics collector that records:

- page evidence from the browser result payload
  - `completedRedditDiagnosticEvents`
  - `pageResourceCandidateEvents`
- local whitelist evidence for Reddit hosts from the Linux whitelist file
- protected canary-group diagnostics for the same Reddit hosts

Linux does not currently maintain a separate native whitelist file like Windows, so the Linux artifact will expose the available Linux-local whitelist evidence without inventing a fake native layer.

### Parser Normalization

`scripts/lib/release-evidence-bundle.mjs` will normalize Linux `artifact.redditDiagnostics` into the same `redditHosts` structure already returned for Windows:

- `globalWhitelist`
- `nativeWhitelist`
- `pageEvent`

For Linux:

- `globalWhitelist` maps from Linux local whitelist presence
- `nativeWhitelist` remains `false` unless Linux artifact data explicitly provides a native whitelist view later
- `pageEvent` maps from `page.completedRedditDiagnosticEvents`

This keeps downstream reporting stable while accurately reflecting current Linux evidence limits.

## Testing

Follow TDD with focused local tests:

- add a failing Linux canary contract test proving the script references the shared Reddit constants and emits `redditDiagnostics`
- add a failing Linux release-evidence test proving Linux artifacts with `redditDiagnostics` normalize into `redditHosts`
- implement the minimum code to make those tests pass
- run only the targeted local tests needed for this change first

## Verification

Initial verification lane: repo-local targeted tests.

Highest intended evidence rung for this task:

- unit/contract test

No staging, runner, or production escalation is needed unless the focused local lane cannot answer the contract question.
