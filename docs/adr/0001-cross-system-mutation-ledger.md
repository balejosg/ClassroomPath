# ADR 0001: Durable Cross-System Mutation Ledger

> Status: maintained
> Applies to: ClassroomPath mutation orchestration
> Last verified: 2026-04-13
> Source of truth: `docs/adr/0001-cross-system-mutation-ledger.md`

**Decision status:** Accepted  
**Date:** 2026-04-01  
**Decision makers:** ClassroomPath maintainers

## Context

ClassroomPath performs workflows that span local tenant tables and upstream OpenPath state.
Request-scoped compensation alone was not enough because failures could happen after local commit,
after upstream mutation, or after process restart.

## Decision

ClassroomPath records cross-system workflow progress in `cp_mutation_operations`.

The ledger stores:

- operation type
- idempotency key
- current step
- status
- local result identifiers
- last error

Supported flows resume from the stored operation state instead of blindly re-running local creation logic.

## Consequences

### Positive

- retries survive process restarts
- failed operations are visible for reconciliation
- orchestration logic can be built on one durable primitive

### Negative

- tests must reset idempotency state explicitly when reusing the same business keys
- service flows become more explicit about steps and retry semantics

### Neutral

- this is not a queue or distributed transaction system; it is a durable orchestration ledger

## Alternatives Considered

- best-effort compensation only: rejected because it loses state across retries and crashes
- full message queue/outbox first: rejected as larger than needed for the current iteration
