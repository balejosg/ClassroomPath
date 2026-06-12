# Runbook: Add a Cross-System Mutation

> Status: maintained
> Applies to: ClassroomPath API mutations that span ClassroomPath state and upstream OpenPath state
> Last verified: 2026-06-11
> Source of truth: `docs/runbooks/add-cross-system-mutation.md`

Background contract: [`docs/contracts/cross-system-mutations.md`](../contracts/cross-system-mutations.md)

## Workflow Families

Every mutation belongs to exactly one family, declared in
`api/src/lib/organization-mutation-workflow/types.ts:OrganizationMutationWorkflowFamily`.

| Family           | Engine function                        | Step sequence                                                | Use when                                                                                                                                 |
| ---------------- | -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `local-first`    | `runLocalFirstMutationWorkflow`        | `pending -> local_committed -> synced_upstream -> completed` | ClassroomPath tenancy state must exist before the upstream OpenPath entity is updated (user roles, org creation, user approval/deletion) |
| `upstream-first` | `runUpstreamFirstProvisioningWorkflow` | `pending -> upstream_created -> local_linked -> completed`   | The upstream OpenPath entity must be created first so its ID can be stored in ClassroomPath (group creation, classroom creation)         |
| `delete`         | `runDeleteMutationWorkflow`            | `local_committed -> completed`                               | Remove tenant link first, then clean up upstream state                                                                                   |

Engine source: `api/src/lib/cross-system-workflow-engine.ts`

## Files to Touch (in order)

1. **`api/src/lib/organization-mutation-workflow/types.ts`**
   - Add the new `kind` variant to `OrganizationBusinessMutation` (union member)
   - Add the new `operationType` string literal to `OrganizationMutationOperationType`

2. **`api/src/lib/organization-mutation-workflow/catalog.ts`**
   - Add an entry to `organizationMutationCatalog` (the `satisfies` constraint enforces
     exhaustiveness against `OrganizationMutationOperationType`)

3. **`api/src/lib/organization-mutation-workflow/retry-adapters.ts`**
   - Add a retry adapter keyed by the new operation type
   - Adapters read metadata back from the stored operation record and re-call the public service
   - Not required for operations without retry support, but strongly recommended

4. **`api/src/services/<domain>-workflow.service.ts`** (new file)
   - Call `runLocalFirstMutationWorkflow`, `runUpstreamFirstProvisioningWorkflow`, or
     `runDeleteMutationWorkflow` with the concrete step handlers
   - See `api/src/services/group-create-from-rules-workflow.service.ts` for a complete example

5. **`api/src/services/<domain>-write.service.ts`** (caller)
   - Call `getOrCreateOrganizationMutationOperation` then invoke your workflow service

## Skeleton for a New Catalog Entry

Below is a literal copy of the `groups.create_group` entry
(`api/src/lib/organization-mutation-workflow/catalog.ts:96-116`) with placeholders replaced:

```typescript
// In api/src/lib/organization-mutation-workflow/types.ts
// 1a. Add to OrganizationMutationOperationType:
type OrganizationMutationOperationType =
  | ... existing entries ...
  | 'domain.operation_name';   // <-- new

// 1b. Add to OrganizationBusinessMutation union:
| {
    kind: 'domainOperationKind';
    organizationId: string;
    userId: string;
    // ... business fields
  }

// -------------------------------------------------------
// In api/src/lib/organization-mutation-workflow/catalog.ts
// 2. Add to organizationMutationCatalog:
  'domain.operation_name': {
    family: 'upstream-first',   // or 'local-first' / 'delete'
    buildFacts: (mutation) => {
      const typed = requireMutationKind(mutation, 'domainOperationKind');
      return {
        family: 'upstream-first',
        operationType: 'domain.operation_name',
        idempotencyKey: `${typed.organizationId}:${typed.uniqueField}`,
        organizationId: typed.organizationId,
        userId: typed.userId,
        metadata: {
          // keep only the fields needed to reconstruct the mutation on retry
        },
      };
    },
  },

// -------------------------------------------------------
// In api/src/lib/organization-mutation-workflow/retry-adapters.ts
// 3. Add to organizationMutationRetryAdapters:
  'domain.operation_name': ({ operation, organizationId, actedBy }) =>
    yourPublicServiceFunction({
      organizationId,
      actorUserId: actedBy,
      field: readString(operation.metadata.field),
    }),
```

## Workflow Service Skeleton (upstream-first example)

Modeled on `api/src/services/group-create-from-rules-workflow.service.ts`:

```typescript
import { runUpstreamFirstProvisioningWorkflow } from '../lib/cross-system-workflow-engine.js';
import type { getOrCreateMutationOperation } from '../lib/cross-system-mutations.js';

type MutationOperation = Awaited<ReturnType<typeof getOrCreateMutationOperation>>;

export async function runMyUpstreamFirstWorkflow(params: {
  operation: MutationOperation;
  organizationId: string;
  // ... domain params
}) {
  const workflow = await runUpstreamFirstProvisioningWorkflow({
    operation: params.operation,
    initialResult: null, // or restored result from operation.result
    initialState: {},
    metadata: params.operation.metadata as Record<string, unknown>,
    createUpstream: async () => {
      const entity = await createUpstreamEntity(/* ... */);
      return {
        organizationId: params.organizationId,
        result: { entityId: entity.id },
      };
    },
    linkLocal: async ({ result }) => {
      if (!result) return;
      await linkTenantRecord({ organizationId: params.organizationId, entityId: result.entityId });
      return { organizationId: params.organizationId, result };
    },
    complete: async ({ result }) => {
      if (!result) return;
      // side effects (publish events, etc.)
      return { organizationId: params.organizationId, result };
    },
  });
  return workflow.result;
}
```

## Verification

After adding the entry, the following tests cover the catalog exhaustively:

- **`api/tests/lib/organization-mutation-workflow/catalog.test.ts`** -- asserts that
  `organizationMutationOperationTypes.length === Object.keys(organizationMutationCatalog).length`
  and that catalog entries carry no `retry` field (line 26-29)
- **`api/tests/organization-mutation-workflow-module.test.ts`** -- re-checks the same
  parity between the type list and the catalog keys at line 109-110
- **`api/tests/organization-mutation-catalog.test.ts`** -- spot-checks
  `buildOrganizationMutationOperation` for existing kinds; add a case for the new kind

Run:

```bash
node --import tsx --test --test-concurrency=1 \
  api/tests/lib/organization-mutation-workflow/catalog.test.ts \
  api/tests/organization-mutation-workflow-module.test.ts \
  api/tests/organization-mutation-catalog.test.ts
```

Or from the API workspace root:

```bash
npm test --workspace=@classroompath/api
```
