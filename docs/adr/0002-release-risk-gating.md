# ADR 0002: Release Risk Gating And Application-Level Recovery

> Status: maintained
> Applies to: ClassroomPath release and rollback policy
> Last verified: 2026-04-13
> Source of truth: `docs/adr/0002-release-risk-gating.md`

**Decision status:** Accepted  
**Date:** 2026-04-01  
**Decision makers:** ClassroomPath maintainers

## Context

Production and staging deploys already had immutable-image and smoke-check structure, but destructive
migrations still represented a point of no return and failure handling was inconsistent across startup,
readiness, and smoke stages.

## Decision

Deploy tooling classifies changed migrations as `safe`, `expand-contract`, or `destructive`.

Rules:

- destructive production releases require a recorded backup or snapshot reference before migrations run
- production rollback may trigger after deploy failure or smoke failure, not only after post-success smoke failure
- staging attempts to restore the previous application release if startup or readiness fails after migrations
- deploy scripts persist context files that record migration risk, backup reference, failure stage, and whether DB migration already happened

## Consequences

### Positive

- operators have a clearer release bar for destructive schema changes
- failures during startup/readiness are easier to interpret and recover from
- rollback context is available even when the deploy fails before smoke

### Negative

- application rollback still does not restore the database automatically
- release scripts and workflow state handling are more complex

### Neutral

- release safety now depends partly on external backup infrastructure or operator-provided backup identifiers

## Alternatives Considered

- treat every migration the same: rejected because destructive changes need stronger safety gates
- automatic DB rollback as part of deploy: rejected because schema and data changes are not generally reversible or safe to auto-undo
