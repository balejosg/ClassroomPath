# Cross-System Mutations

## Purpose

This document defines the ordering and recovery model for ClassroomPath mutations that span ClassroomPath tables and upstream OpenPath state.

## Source Of Truth

- tenant membership and tenancy links: ClassroomPath
- mirrored role state and whitelist/classroom entities: OpenPath
- orchestration progress and retry state: `cp_mutation_operations`

## Ordering Rules

### Onboarding / pending user approval / user role flows

1. Commit ClassroomPath tenant state first
2. Persist mutation result in `cp_mutation_operations`
3. Synchronize upstream OpenPath role state
4. Persist final completion state

### Group / classroom provisioning flows

1. Create upstream OpenPath entity first
2. Persist created upstream id in `cp_mutation_operations`
3. Link tenant state in ClassroomPath
4. Run role or notification side effects
5. Persist final completion state

### Delete flows

1. Remove tenant link first
2. Persist local completion in `cp_mutation_operations`
3. Delete or downgrade upstream state if no longer referenced
4. Persist final completion state

## Retry Model

- Repeated calls with the same business key resume from `cp_mutation_operations`
- `completed` operations return their stored result instead of re-running
- `failed` operations retain `last_error` and can be retried explicitly
- retries should reuse stored result identifiers when present

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

Organization admins can inspect org-scoped mutation operations and retry supported failed operations through the reconciliation service layer.
