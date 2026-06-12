# Runbook: Write Integration Tests

> Status: maintained
> Applies to: ClassroomPath API integration tests in `api/tests/integration/`
> Last verified: 2026-06-12
> Source of truth: `docs/runbooks/write-integration-tests.md`

The integration test suite has ~61 hand-rolled `signToken` call-sites and 35+ ad-hoc scenario
setups that duplicate work the shared harness already handles. This runbook shows the canonical
patterns so new tests do not add more copies.

## 1. Boot an integration server

Every integration test file must set `JWT_SECRET` and `NODE_ENV` before any app imports.
The shared helper `tests/helpers/test-env.ts` does this at module-evaluation time, so import
it FIRST, then call `useIntegrationServer`. The hook registers `before` / `after` hooks
automatically. Use the exported `TEST_JWT_SECRET` wherever the secret value is needed
(for example as `jwtSecret` in signing calls); do not redeclare a local copy.

```typescript
// Must appear before any other imports.
import { TEST_JWT_SECRET } from '../helpers/test-env.js';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useIntegrationServer } from './harness.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

describe('my feature', async () => {
  test('something works', async () => {
    // integration.baseUrl is available inside tests after before() has run.
    assert.ok(integration.baseUrl);
  });
});
```

`resetBeforeStart: true` resets the database tables before the suite starts. Omit it only for
read-only suites that do not mutate state.

## 2. Create auth tokens the canonical way

Use `signToken` from `harness.ts`. Do not call `jwt.sign` directly; `signToken` wires the
correct payload shape (`sub`, `type`, `email`, `name`, `roles`) and defaults (`issuer`,
`expiresIn`).

```typescript
import { signToken, ensureOpenPathUser } from './harness.js';

// 1. Insert the user row into the OpenPath database.
const userId = `test-user-${Date.now()}`;
const email = `user-${Date.now()}@test.local`;
await ensureOpenPathUser({ userId, email, name: 'Test User' });

// 2. Sign a token with the same identity.
const token = signToken({
  jwtSecret: TEST_JWT_SECRET, // pass explicitly; never rely on process.env alone in tests
  userId,
  email,
  name: 'Test User',
  roles: [{ role: 'admin', groupIds: [] }],
});
```

For tokens without an organization role, pass `roles: []`.

## 3. Bootstrap an org/tenant

`bootstrapOrg` creates the organization record, an admin membership, and an active entitlement
with `classroomLimit: 100` in one call. Use it when you need a fully licensed organization.

```typescript
import { bootstrapOrg } from './harness.js';

const { organizationId } = await bootstrapOrg({
  baseUrl: integration.baseUrl,
  token, // must be a token with sub matching the intended org creator
  name: 'Test School',
});
```

## 4. Make a tRPC call and parse the envelope

Use `trpcQuery` (GET) or `trpcMutate` (POST) from `test-utils.ts`, then unwrap the tRPC
envelope with `parseTRPC`. Use `assertStatus` for status assertions.

```typescript
import { assertStatus, bearerAuth, parseTRPC, trpcMutate, trpcQuery } from '../test-utils.js';

// Query (GET)
const listResp = await trpcQuery(
  integration.baseUrl,
  'users.list',
  undefined, // input -- omit or pass a JSON-serializable object
  bearerAuth(token)
);
assertStatus(listResp, 200);
const { data } = (await parseTRPC(listResp)) as { data: Array<{ email: string }> };

// Mutation (POST)
const mutResp = await trpcMutate(
  integration.baseUrl,
  'pendingUsers.approve',
  { userId: memberUserId, role: 'teacher' },
  bearerAuth(adminToken)
);
assertStatus(mutResp, 200);
```

The tRPC endpoint base path is `/cp/trpc/<procedure>`. `parseTRPC` returns `{ data }` on
success or `{ error, code }` on a tRPC error.

> **Where these helpers come from**: `parseTRPC`, `assertStatus`, `bearerAuth`, `trpcQuery`, and
> `trpcMutate` are defined in `api/tests/test-trpc.ts` and re-exported through
> `api/tests/test-utils.ts` (which also re-exports `test-db.ts` and `test-network.ts`). Always
> import from `../test-utils.js` so that the barrel import path remains stable.

## 5. Use the scenario builder for multi-entity setups

`createTenantScenario` in `scenario-builder.ts` wraps the low-level harness calls for
common multi-entity configurations (admin + organization, members, groups, classrooms,
schedules). Prefer it over direct `db.insert` calls when the scenario matches.

```typescript
import { createTenantScenario } from './scenario-builder.js';
import { assertStatus, bearerAuth, parseTRPC, trpcQuery } from '../test-utils.js';

const scenario = createTenantScenario({
  baseUrl: integration.baseUrl,
  jwtSecret: TEST_JWT_SECRET,
});

// Seed a fully licensed admin + organization in one call.
const { actor: admin, organization } = await scenario.seedOrgAdmin({
  userId: `admin-${Date.now()}`,
  organizationName: `School ${Date.now()}`,
});

// Add a member.
const teacher = await scenario.seedMember({
  organizationId: organization.organizationId,
  invitedBy: admin.userId,
  role: 'teacher',
  userId: `teacher-${Date.now()}`,
});

// Create a group and classroom.
const group = await scenario.createGroup({ actor: admin, name: `grp-${Date.now()}` });
const classroom = await scenario.createClassroom({
  actor: admin,
  name: `cls-${Date.now()}`,
  defaultGroupId: group.id,
});

// Use the tokens directly.
const resp = await trpcQuery(integration.baseUrl, 'users.list', undefined, bearerAuth(admin.token));
assertStatus(resp, 200);
const { data } = (await parseTRPC(resp)) as { data: Array<{ email: string }> };
assert.ok(data.some((u) => u.email === teacher.email));
```

## Do not do this

- **Hand-roll `jwt.sign`** -- use `signToken` from `harness.ts`. The payload shape matters
  and diverging copies break the mock OpenPath server's `buildMockAuthMeResponse`.
- **Call `fetch` directly** for tRPC -- use `trpcQuery` / `trpcMutate` + `parseTRPC`. They
  handle encoding, the correct base path, and envelope unwrapping.
- **Insert organization or membership rows by hand** when `bootstrapOrg` or
  `scenario.seedOrgAdmin` already does the right thing. Direct inserts miss the entitlement
  row and produce tests that fail on entitlement-guarded procedures.
- **Skip `useIntegrationServer`** and call `startIntegrationServer` directly -- the hook
  manages the suite lock and database teardown that prevent suite-to-suite interference.
- **Use a shared top-level `organizationId` constant** across tests in the same suite without
  `resetBeforeStart: true` -- state leaks between tests produce order-dependent failures.
