# ClassroomPath Presenters, Turbo, and Gateway Composition Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract a shared DTO/presenters package, move local build and static verification to Turbo-backed workspace orchestration, and split gateway composition into smaller modules without changing runtime behavior.

**Architecture:** Keep behavior stable while tightening package boundaries. `@classroompath/presenters` becomes the only shared home for onboarding DTOs and tenant presenter helpers, `turbo` becomes the root scheduler for build/static steps, and the API server delegates gateway wiring through a small composition layer rather than importing every route registrar directly.

**Tech Stack:** npm workspaces, TypeScript, Turbo, Express, tRPC, Vitest/Node test runner, Playwright.

### Task 1: Lock the new architecture with failing tests

**Files:**

- Modify: `api/tests/workspace-packages.test.ts`
- Modify: `tests/deployment.test.ts`
- Create: `api/tests/gateway-composition.test.ts`

1. Add assertions for a new `presenters` workspace and `@classroompath/presenters` imports.
2. Add assertions that build/static verification route through Turbo-backed orchestration.
3. Add a gateway composition architecture test that requires a composition module plus finer route modules.
4. Run only those tests and confirm they fail for the expected missing-workspace/missing-file/import reasons.

### Task 2: Extract `@classroompath/presenters`

**Files:**

- Create: `presenters/package.json`
- Create: `presenters/tsconfig.json`
- Create: `presenters/src/index.ts`
- Create: `presenters/src/onboarding.ts`
- Create: `presenters/src/tenant-presenters.ts`
- Modify: `package.json`
- Modify: `api/package.json`
- Modify: `react-spa/package.json`
- Modify: `api/src/services/presenters.ts`
- Modify: `api/src/services/onboarding.service.ts`
- Modify: `react-spa/src/app/OnboardingAccessGate.tsx`
- Modify: `react-spa/src/views/Onboarding.tsx`

1. Move pure onboarding DTO types and tenant presenter helpers into the new workspace.
2. Leave compatibility wrappers where that lowers churn.
3. Rewire API and SPA imports to consume the new package instead of local source files for shared contracts.
4. Run targeted tests for the new package boundaries and affected units.

### Task 3: Make build/static verification Turbo-backed

**Files:**

- Create: `turbo.json`
- Create: `scripts/run-turbo.sh`
- Modify: `package.json`
- Modify: `scripts/build-classroompath.sh`
- Modify: `scripts/verify-full.ts`
- Modify: workspace `package.json` files as needed for `typecheck`/`lint`

1. Add a root Turbo pipeline for `build`, `typecheck`, and `lint`.
2. Keep the shell entrypoints thin; route actual orchestration through Turbo.
3. Ensure static verification still preserves the current policy around format, security, coverage, and Playwright.
4. Run deployment/workflow regression tests plus targeted build/static commands.

### Task 4: Split gateway composition into smaller modules

**Files:**

- Create: `api/src/lib/gateway/base-middleware.ts`
- Create: `api/src/lib/gateway/health-routes.ts`
- Create: `api/src/lib/gateway/proxy-routes.ts`
- Create: `api/src/lib/gateway/application-routes.ts`
- Create: `api/src/lib/gateway/spa-routes.ts`
- Create: `api/src/lib/gateway/compose-gateway.ts`
- Modify: `api/src/lib/gateway-routes.ts`
- Modify: `api/src/server.ts`
- Modify: affected gateway tests

1. Move each gateway concern into a focused module.
2. Keep `gateway-routes.ts` as a compatibility surface if that avoids broader churn.
3. Make `server.ts` depend on one composition entrypoint instead of individual registrars.
4. Run gateway-focused tests and integration smoke coverage.

### Task 5: Final verification and commit

**Files:**

- Modify: any touched tests/docs/config as required

1. Run targeted tests for workspace boundaries, deployment/gateway architecture, and affected API/SPA units.
2. Run `npm run verify:commit`.
3. Commit on `main` with a single message covering the three refactors.
