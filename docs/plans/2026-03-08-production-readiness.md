# ClassroomPath Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Close the code and product risks that currently block ClassroomPath from being safely promoted to production, excluding deployment mechanics and environment configuration.

**Architecture:** The main change is to stop treating ClassroomPath as a thin tenant wrapper over a broadly exposed OpenPath gateway. Make tenant authorization authoritative in ClassroomPath, reduce upstream passthrough to an explicit allowlist, and make session handling consistent with an HttpOnly-cookie model. Then raise the verification bar so green tests actually mean something.

**Tech Stack:** TypeScript, Node test runner, Vitest, Playwright, Express, tRPC, Drizzle, React, OpenPath submodule, ClassroomPath gateway.

**Planning Notes**

- This plan spans **two repositories**: `ClassroomPath/` and `OpenPath/` via `ClassroomPath/upstream/openpath/`.
- Before touching OpenPath code, use `architectural-gatekeeper`.
- Before implementation, use `testing-strategy`.
- When committing across both repos, use `multi-repo-commit`.

## Delivery Order

### Week 1

1. Lock down upstream passthrough and residual admin access
2. Make membership removal and role changes authoritative
3. Stop leaking tokens to the frontend and fully revoke sessions
4. Fail hard on missing/default JWT secret

### Week 2

5. Unify role source-of-truth
6. Add missing tests for critical admin/auth flows
7. Harden verification gates and make regression coverage mandatory

---

### Task 1: Replace the Gateway Denylist with an Explicit Upstream Allowlist

**Files:**

- Modify: `ClassroomPath/api/src/lib/openpath-proxy-policy.ts`
- Modify: `ClassroomPath/api/src/lib/gateway-routes.ts`
- Test: `ClassroomPath/api/tests/openpath-proxy-policy.test.ts`
- Test: `ClassroomPath/api/tests/gateway-routes.test.ts`
- Test: `ClassroomPath/api/tests/integration/gateway.integration.test.ts`

**Why first:** Every other authorization fix is weaker while the gateway still exposes most upstream `/trpc` and `/api`.

**Step 1: Write the failing tests**

Add tests that reject direct passthrough to at least:

- `setup.getRegistrationToken`
- `auth.generateResetToken`
- `healthReports.list`
- any non-tenant-scoped router not explicitly approved

Example assertion:

```ts
assert.strictEqual(
  findBlockedOpenPathProcedureFromUrl('/trpc/setup.getRegistrationToken'),
  'setup.getRegistrationToken'
);
```

**Step 2: Run targeted tests and confirm failure**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/openpath-proxy-policy.test.ts tests/gateway-routes.test.ts
```

**Step 3: Implement minimal policy**

Change the model from:

- “block some tenant routers”

To:

- “allow only explicitly approved upstream passthrough endpoints”

Approved passthroughs should be as small as possible, for example:

- `/health`
- `/api/machines/events`
- any other endpoint that ClassroomPath truly cannot re-expose safely through `/cp/trpc`

**Step 4: Verify**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/openpath-proxy-policy.test.ts tests/gateway-routes.test.ts tests/integration/gateway.integration.test.ts
```

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
git add api/src/lib/openpath-proxy-policy.ts api/src/lib/gateway-routes.ts api/tests/openpath-proxy-policy.test.ts api/tests/gateway-routes.test.ts api/tests/integration/gateway.integration.test.ts
git commit -m "fix(api): restrict upstream passthrough to explicit allowlist"
```

---

### Task 2: Make User Removal and Approval Revoke Real OpenPath Privileges

**Files:**

- Modify: `ClassroomPath/api/src/trpc/routers/users.ts`
- Modify: `ClassroomPath/api/src/services/pending-users.service.ts`
- Modify: `ClassroomPath/api/src/lib/openpath-roles.ts`
- Test: `ClassroomPath/api/tests/integration/users.integration.test.ts`
- Test: `ClassroomPath/api/tests/pending-users.service.test.ts`

**Dependency:** Task 1

**Step 1: Write the failing tests**

Cover these cases:

- `users.delete` removes tenant membership **and** strips effective OpenPath admin/teacher privileges
- `users.revokeRole` updates both ClassroomPath and OpenPath state
- `approveUser` can demote as well as promote when required by tenant role

Example expectation:

```ts
assert.strictEqual(openPathAdminEndpointsStillAccessible, false);
```

**Step 2: Run targeted tests and confirm failure**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/pending-users.service.test.ts tests/integration/users.integration.test.ts
```

**Step 3: Implement minimal synchronization**

Introduce one clear rule:

- when tenant membership is removed or role changes, OpenPath role state must be recomputed and updated immediately

Do not leave “best effort” cleanup as the final behavior.

**Step 4: Verify**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/pending-users.service.test.ts tests/integration/users.integration.test.ts
```

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
git add api/src/trpc/routers/users.ts api/src/services/pending-users.service.ts api/src/lib/openpath-roles.ts api/tests/pending-users.service.test.ts api/tests/integration/users.integration.test.ts
git commit -m "fix(api): synchronize tenant membership with upstream privileges"
```

---

### Task 3: Enforce a Real HttpOnly-Cookie Session Model

**Files:**

- Modify: `ClassroomPath/api/src/trpc/routers/auth.ts`
- Modify: `ClassroomPath/api/src/trpc/routers/onboarding.ts`
- Modify: `ClassroomPath/react-spa/src/views/Login.tsx`
- Modify: `ClassroomPath/react-spa/src/views/Register.tsx`
- Modify: `ClassroomPath/react-spa/src/ClassroomPathApp.tsx`
- Modify: `ClassroomPath/upstream/openpath/api/src/services/auth.service.ts`
- Modify: `ClassroomPath/upstream/openpath/api/src/trpc/routers/auth.ts`
- Test: `ClassroomPath/api/tests/session-cookies.test.ts`
- Test: `ClassroomPath/api/tests/integration/gateway.integration.test.ts`
- Test: `ClassroomPath/react-spa/src/views/__tests__/Login.test.tsx`
- Test: `ClassroomPath/react-spa/src/views/__tests__/Register.test.tsx`

**Dependency:** none, but it should ship with Task 4

**Step 1: Write the failing tests**

Add tests that prove:

- login response does **not** include `accessToken` or `refreshToken`
- google login response does **not** include tokens
- onboarding org creation does **not** include tokens
- logout forwards the refresh token or otherwise revokes both access and refresh state

Example expectation:

```ts
assert.equal('accessToken' in body, false);
assert.equal('refreshToken' in body, false);
```

**Step 2: Run targeted tests and confirm failure**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/session-cookies.test.ts tests/integration/gateway.integration.test.ts

cd /datos_nvme/run0/Whitelist/ClassroomPath/react-spa
npx vitest run src/views/__tests__/Login.test.tsx src/views/__tests__/Register.test.tsx
```

**Step 3: Implement minimal fix**

- Strip tokens from JSON responses at the OpenPath service/router boundary or at the ClassroomPath gateway boundary
- Keep cookies as the only browser session carrier
- Ensure logout revokes both token classes

**Step 4: Verify**

Run the same targeted tests, then:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
npm test --workspace=@classroompath/react-spa
```

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/upstream/openpath
git add api/src/services/auth.service.ts api/src/trpc/routers/auth.ts
git commit -m "fix(api): stop returning browser session tokens in auth responses"

cd /datos_nvme/run0/Whitelist/ClassroomPath
git add api/src/trpc/routers/auth.ts api/src/trpc/routers/onboarding.ts react-spa/src/views/Login.tsx react-spa/src/views/Register.tsx react-spa/src/ClassroomPathApp.tsx api/tests/session-cookies.test.ts api/tests/integration/gateway.integration.test.ts react-spa/src/views/__tests__/Login.test.tsx react-spa/src/views/__tests__/Register.test.tsx
git commit -m "fix(auth): enforce cookie-backed sessions in classroompath"
```

---

### Task 4: Fail Fast on Missing or Default JWT Secret

**Files:**

- Modify: `ClassroomPath/api/src/config.ts`
- Modify: `ClassroomPath/api/src/server.ts`
- Test: `ClassroomPath/api/tests/jwt-config.test.ts`
- Test: `ClassroomPath/api/tests/server-hardening.test.ts`

**Dependency:** none

**Step 1: Write the failing tests**

Add tests for:

- missing `JWT_SECRET` in production-like mode
- default dev secret in production-like mode

Example expectation:

```ts
assert.throws(() => loadConfig(), /JWT_SECRET/i);
```

**Step 2: Run targeted tests and confirm failure**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/jwt-config.test.ts tests/server-hardening.test.ts
```

**Step 3: Implement minimal guard**

- no fallback secret in production
- preferably no fallback secret outside explicit test mode either

**Step 4: Verify**

Run the same targeted tests.

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
git add api/src/config.ts api/src/server.ts api/tests/jwt-config.test.ts api/tests/server-hardening.test.ts
git commit -m "fix(api): require explicit jwt secret outside test mode"
```

---

### Task 5: Collapse Role Source-of-Truth to One Authoritative Model

**Files:**

- Modify: `ClassroomPath/api/src/trpc/trpc.ts`
- Modify: `ClassroomPath/api/src/trpc/routers/users.ts`
- Modify: `ClassroomPath/api/src/services/pending-users.service.ts`
- Modify: `ClassroomPath/api/src/db/schema.ts` (only if schema change is needed)
- Test: `ClassroomPath/api/tests/tenant-memberships.test.ts`
- Test: `ClassroomPath/api/tests/integration/users.integration.test.ts`
- Test: `ClassroomPath/api/tests/integration/multi-org-membership.integration.test.ts`

**Dependency:** Task 2

**Step 1: Decide and document the rule**

Pick one:

- `cp_memberships.role` is authoritative for tenant authorization, OpenPath mirrors it

Recommended: this one.

**Step 2: Write failing tests**

Add tests that prove:

- `assignRole` updates the authoritative tenant role
- `revokeRole` cannot leave stale ClassroomPath role state behind
- `tenantProcedure` sees the same effective role that UI and admin actions see

**Step 3: Implement minimal consistency**

- update role writes to the authoritative table first
- sync OpenPath second
- fail if sync cannot complete cleanly

**Step 4: Verify**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/api
node --import tsx --test tests/tenant-memberships.test.ts tests/integration/users.integration.test.ts tests/integration/multi-org-membership.integration.test.ts
```

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
git add api/src/trpc/trpc.ts api/src/trpc/routers/users.ts api/src/services/pending-users.service.ts api/src/db/schema.ts api/tests/tenant-memberships.test.ts api/tests/integration/users.integration.test.ts api/tests/integration/multi-org-membership.integration.test.ts
git commit -m "refactor(api): make tenant role state authoritative"
```

---

### Task 6: Add Direct Tests for Critical SPA/Admin Flows

**Files:**

- Modify: `ClassroomPath/react-spa/src/views/__tests__/Login.test.tsx`
- Modify: `ClassroomPath/react-spa/src/views/__tests__/Register.test.tsx`
- Create or modify: `ClassroomPath/react-spa/src/views/__tests__/PendingUsers.test.tsx`
- Modify: `ClassroomPath/react-spa/src/components/__tests__/GroupLibrary.test.tsx`
- Modify: `ClassroomPath/tests/e2e/waiting-room.spec.ts`
- Modify: `ClassroomPath/.test-allowlist`

**Dependency:** Task 3

**Step 1: Write the failing tests**

Required coverage:

- Login success and error handling
- Google login error path
- Pending user approve/reject success and failure
- GroupLibrary actions beyond modal open/close
- E2E path where admin actually approves a waiting user

**Step 2: Run targeted tests and confirm failure**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath/react-spa
npx vitest run src/views/__tests__/Login.test.tsx src/views/__tests__/Register.test.tsx src/views/__tests__/PendingUsers.test.tsx src/components/__tests__/GroupLibrary.test.tsx
```

**Step 3: Implement minimal code changes only if tests reveal bugs**

Do not refactor for style here. Fix only real behavior gaps found by tests.

**Step 4: Verify**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
npm test --workspace=@classroompath/react-spa
```

Then run the specific E2E:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
npx playwright test tests/e2e/waiting-room.spec.ts
```

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
git add react-spa/src/views/__tests__/Login.test.tsx react-spa/src/views/__tests__/Register.test.tsx react-spa/src/views/__tests__/PendingUsers.test.tsx react-spa/src/components/__tests__/GroupLibrary.test.tsx tests/e2e/waiting-room.spec.ts .test-allowlist
git commit -m "test(spa): cover auth and pending user admin flows"
```

---

### Task 7: Make Verification Green Mean “Production-Ready”

**Files:**

- Modify: `ClassroomPath/scripts/verify-full.sh`
- Modify: `ClassroomPath/react-spa/vitest.config.ts`
- Modify: `ClassroomPath/api/scripts/run-test-coverage.mjs`
- Modify: `ClassroomPath/api/tests/integration/gateway.integration.test.ts`
- Modify: `ClassroomPath/tests/e2e/navigation-noop-repro.spec.ts` (tag only if policy changes)
- Modify: `ClassroomPath/tests/e2e/performance.spec.ts` (only if policy/tag changes)

**Dependency:** Task 6

**Step 1: Write the failing tests/checks**

Define hard rules first:

- SPA coverage thresholds: lines/functions/branches
- API coverage thresholds: lines/functions/branches
- no “200 or 500” tests for critical flows
- `@repro` included in mandatory verify or moved to a separate mandatory smoke set

Recommended minimums:

- SPA: 80% lines, 70% branches, 75% functions
- API: 80% lines, 70% branches, 75% functions

**Step 2: Make the gate fail**

Update config/scripts so current state fails honestly.

**Step 3: Fix the weakest tests first**

Expected targets:

- `Login.tsx`
- `PendingUsers.tsx`
- gateway integration tests for `auth.me` and `apiTokens.create`

**Step 4: Verify end-to-end**

Run:

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
npm run test:coverage --workspace=@classroompath/react-spa
npm run test:coverage --workspace=@classroompath/api
bash scripts/verify-full.sh
```

**Step 5: Commit**

```bash
cd /datos_nvme/run0/Whitelist/ClassroomPath
git add scripts/verify-full.sh react-spa/vitest.config.ts api/scripts/run-test-coverage.mjs api/tests/integration/gateway.integration.test.ts tests/e2e/navigation-noop-repro.spec.ts tests/e2e/performance.spec.ts
git commit -m "test: harden production readiness verification gates"
```

---

## Exit Criteria

The plan is complete when all of these are true:

- Removing or demoting a tenant user removes their real upstream privilege
- Browser auth flows no longer expose tokens in JSON
- Logout revokes all session material
- ClassroomPath refuses to run with a default/missing JWT secret
- Tenant role state is authoritative and synchronized
- `PendingUsers`, `Login`, and `GroupLibrary` have meaningful direct tests
- `verify-full` enforces global coverage and critical regression suites

## Suggested Execution Split

### Track A: Security Blockers

- Task 1
- Task 2
- Task 3
- Task 4

### Track B: Confidence and Maintainability

- Task 5
- Task 6
- Task 7

Track B should not start before Track A is stable enough to avoid rewriting tests twice.

Plan complete and saved to `ClassroomPath/docs/plans/2026-03-08-production-readiness.md`.

Two execution options:

**1. Subagent-Driven (this session)** - implement task-by-task here with review checkpoints

**2. Parallel Session (separate)** - implement from the saved plan in a fresh execution session
