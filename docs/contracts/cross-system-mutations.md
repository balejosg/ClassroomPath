# Cross-System Mutations

> Status: maintained
> Applies to: ClassroomPath service-layer mutations that span ClassroomPath state and upstream OpenPath state
> Last verified: 2026-04-13
> Source of truth: `docs/contracts/cross-system-mutations.md`

## Purpose

This document defines the ordering, persistence, and retry model for ClassroomPath mutations that
span ClassroomPath tenancy data and upstream OpenPath state.

## Source Of Truth

- `api/src/db/schema.ts`
- `api/src/lib/cross-system-mutations.ts`
- `api/src/services/onboarding.service.ts`
- `api/src/services/pending-users.service.ts`
- `api/src/services/user.service.ts`
- `api/src/services/group-write.service.ts`
- `api/src/services/classrooms/classroom-write.service.ts`
- `api/src/services/cross-system-reconciliation.service.ts`

Operational ownership:

- tenancy links and org-specific metadata: ClassroomPath
- mirrored role state plus upstream groups/classrooms: OpenPath
- orchestration progress, stored results, and retry metadata: `cp_mutation_operations`

## Ledger Shape

Each mutation operation is keyed by:

- `operation_type`
- `idempotency_key`

Each record persists:

- `status`: `in_progress`, `completed`, or `failed`
- `current_step`
- `organization_id` and `user_id` where applicable
- `metadata`
- `result`
- `last_error`

Current step values used by the implementation include:

- `pending`
- `upstream_created`
- `local_linked`
- `local_committed`
- `synced_upstream`
- `completed`
- `failed`

## Ordering Rules

### Local-First Flows

Applies to:

- `onboarding.create_organization`
- `pending_users.approve_user`
- `users.assign_role`
- `users.revoke_role`
- `users.delete_organization_user`

Sequence:

1. Commit ClassroomPath tenant state first
2. Persist progress and the local result in `cp_mutation_operations`
3. Synchronize upstream OpenPath role state
4. Run audit or side-effect work
5. Persist final completion state

### Upstream-First Provisioning Flows

Applies to:

- `groups.create_group`
- `classrooms.create_classroom`

Sequence:

1. Create the upstream OpenPath entity first
2. Persist the created upstream identifier in `cp_mutation_operations`
3. Link tenant state in ClassroomPath
4. Run role or notification side effects
5. Persist final completion state

### Delete Flows

Applies to:

- `groups.delete_group`
- `classrooms.delete_classroom`

Sequence:

1. Remove or mark the tenant link first
2. Persist local completion in `cp_mutation_operations`
3. Delete or downgrade upstream state if no longer referenced
4. Persist final completion state

## Retry Model

- repeated calls with the same business key resume from `cp_mutation_operations`
- `completed` operations reuse their stored result instead of relying on request-local memory
- `failed` operations retain `last_error` and can be retried explicitly
- retries reuse stored result identifiers when present

Operation-specific behavior:

- onboarding, pending-user approval, role changes, and user deletion reuse stored success results
- create-group and create-classroom flows preserve uniqueness semantics and may still surface
  conflicts on repeated completed requests
- retry entrypoints operate on the persisted operation record, not on ephemeral request state

## Supported Operation Types

- `onboarding.create_organization`
- `pending_users.approve_user`
- `users.assign_role`
- `users.revoke_role`
- `users.delete_organization_user`
- `groups.create_group`
- `groups.delete_group`
- `classrooms.create_classroom`
- `classrooms.delete_classroom`

## Reconciliation

Organization admins can inspect org-scoped mutation operations and retry supported failed operations
through the reconciliation service layer. Unknown or unsupported operation names fail closed.
