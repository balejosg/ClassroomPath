# ClassroomPath Compatibility Matrix

> Status: maintained
> Applies to: technical evaluation and rollout scoping
> Last verified: 2026-04-13
> Source of truth: `docs/evaluation/compatibility-matrix.md`

This matrix is intended to answer a practical question early: does the current product shape match the environment a school wants to evaluate first?

## Current Product Surface

| Area                              | Current documented shape                                                     | Primary source                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Public service entrypoint         | `gateway` owns `/cp/*`                                                       | [`../contracts/routes-ports.md`](../contracts/routes-ports.md)                                                  |
| Core policy and endpoint behavior | Provided by OpenPath                                                         | [OpenPath README](https://github.com/balejosg/openpath/blob/main/README.md)                                     |
| Linux endpoint path               | Debian/Ubuntu-style Linux agent                                              | [OpenPath Linux README](https://github.com/balejosg/openpath/blob/main/linux/README.md)                         |
| Windows endpoint path             | PowerShell-based Windows agent                                               | [OpenPath Windows README](https://github.com/balejosg/openpath/blob/main/windows/README.md)                     |
| Browser diagnosis path            | Firefox-focused extension and managed browser rollout helpers                | [OpenPath Firefox extension README](https://github.com/balejosg/openpath/blob/main/firefox-extension/README.md) |
| Session/auth boundary             | Cookie-backed sessions with origin checks for cookie-authenticated mutations | [`../SESSION_SECURITY_MODEL.md`](../SESSION_SECURITY_MODEL.md)                                                  |

## Questions To Confirm During Evaluation

Confirm these before promising rollout fit:

- Which endpoint platforms are in scope first?
- Is browser-level diagnosis part of the support workflow?
- Does the pilot depend on Linux endpoints, Windows endpoints, or both?
- Does the evaluation require features not currently documented in maintained docs?

## What This Matrix Does Not Mean

This matrix does not claim:

- universal support for every browser or endpoint management tool
- full parity across every platform and rollout path
- support for undocumented deployment topologies

Treat it as a scoping aid, not as a substitute for a technical review.
