# Internal Packages Boundary Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extraer contratos compartidos y soporte de test a workspaces internos explícitos para eliminar imports cruzados entre `api/`, `react-spa/` y `tests/`.

**Architecture:** `@classroompath/contracts` será el único paquete para contratos tipados compartidos entre backend y frontend. `@classroompath/testkit` agrupará runtime E2E, actores sembrados, harness tRPC y sink de correo de test. `api/`, `react-spa/` y las suites de test consumirán esos paquetes por nombre de workspace, no por rutas relativas hacia código ajeno.

**Tech Stack:** npm workspaces, TypeScript `NodeNext`, Vitest, Node test runner, Playwright, tsx.

### Task 1: Proteger la frontera con tests rojos

**Files:**

- Create: `api/tests/workspace-packages.test.ts`

**Step 1: Write the failing test**

Comprobar que:

- el root workspace declara `contracts` y `testkit`
- `react-spa/src/views/Onboarding.tsx` y `react-spa/src/views/Waiting.tsx` importan `@classroompath/contracts/onboarding-policy`
- `api/tests/integration/scenario-builder.ts` y `api/tests/integration/tenant-api-harness.integration.test.ts` importan `@classroompath/testkit/tenant-api-harness`
- `api/src/services/email.service.ts`, `tests/e2e/setup/global-setup.ts`, `tests/e2e/setup/test-environment.ts`, `tests/e2e/auth-email.spec.ts` y `tests/e2e/fixtures/mailboxes/local-sink-provider.ts` consumen `@classroompath/testkit/test-email-sink`

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test api/tests/workspace-packages.test.ts`

Expected: FAIL porque los workspaces y los imports todavía no existen.

### Task 2: Extraer `@classroompath/contracts`

**Files:**

- Create: `contracts/package.json`
- Create: `contracts/tsconfig.json`
- Create: `contracts/src/onboarding-policy.ts`
- Create: `contracts/src/index.ts`
- Modify: `package.json`
- Modify: `scripts/build-classroompath.sh`
- Modify: `api/package.json`
- Modify: `react-spa/package.json`
- Modify: `react-spa/src/views/Onboarding.tsx`
- Modify: `react-spa/src/views/Waiting.tsx`
- Modify: `api/src/services/onboarding.service.ts`
- Modify: `api/tests/onboarding-policy.test.ts`

**Step 1: Write/adjust the minimal code**

Crear el workspace con `exports` explícitos y mover ahí el contrato de onboarding.

**Step 2: Run focused tests**

Run:

- `npm run build --workspace=@classroompath/contracts`
- `node --import tsx --test api/tests/onboarding-policy.test.ts`
- `npm --workspace=@classroompath/react-spa exec vitest run src/views/__tests__/OnboardingPolicy.test.tsx`

Expected: PASS.

### Task 3: Extraer `@classroompath/testkit`

**Files:**

- Create: `testkit/package.json`
- Create: `testkit/tsconfig.json`
- Create: `testkit/src/index.ts`
- Create: `testkit/src/e2e-runtime.ts`
- Create: `testkit/src/test-actors.ts`
- Create: `testkit/src/tenant-api-harness.ts`
- Create: `testkit/src/test-email-sink.ts`
- Modify: `package.json`
- Modify: `scripts/build-classroompath.sh`
- Modify: `api/package.json`
- Modify: `tests/helpers/e2e-runtime.ts`
- Modify: `tests/helpers/test-actors.ts`
- Modify: `tests/helpers/tenant-api-harness.ts`
- Modify: `api/tests/integration/scenario-builder.ts`
- Modify: `api/tests/integration/tenant-api-harness.integration.test.ts`
- Modify: `tests/e2e/fixtures/mailboxes/local-sink-provider.ts`
- Modify: `tests/e2e/setup/worker-runtime.test.ts`
- Modify: `tests/helpers/test-actors.test.ts`

**Step 1: Write the minimal implementation**

Mover la lógica real al package y dejar wrappers locales finos solo donde convenga por compatibilidad interna.

**Step 2: Run focused tests**

Run:

- `npm run build --workspace=@classroompath/testkit`
- `node --import tsx --test tests/helpers/test-actors.test.ts tests/e2e/setup/worker-runtime.test.ts`
- `node --import tsx --test --test-concurrency=1 api/tests/integration/tenant-api-harness.integration.test.ts`

Expected: PASS.

### Task 4: Separar el runtime de test del código de aplicación

**Files:**

- Modify: `api/src/services/email.service.ts`
- Modify: `api/tests/test-email-sink.test.ts`
- Modify: `tests/e2e/auth-email.spec.ts`
- Modify: `tests/e2e/fixtures/mailbox-providers.test.ts`
- Modify: `tests/e2e/setup/global-setup.ts`
- Modify: `tests/e2e/setup/test-environment.ts`

**Step 1: Write the minimal implementation**

Hacer que la app consuma el sink de correo de test desde `@classroompath/testkit/test-email-sink` en vez de `api/src/lib`.

**Step 2: Run focused tests**

Run:

- `node --import tsx --test api/tests/test-email-sink.test.ts`
- `node --import tsx --test tests/e2e/fixtures/mailbox-providers.test.ts tests/e2e/setup/test-environment.test.ts tests/e2e/setup/global-setup.test.ts`

Expected: PASS.

### Task 5: Actualizar workspace/lockfile y cerrar la verificación

**Files:**

- Modify: `package-lock.json`
- Modify: `api/tests/workspace-packages.test.ts`

**Step 1: Update lockfile and verify boundaries**

Run:

- `npm install --ignore-scripts`
- `node --import tsx --test api/tests/workspace-packages.test.ts`

Expected: PASS.

### Task 6: Ejecutar la verificación final

**Step 1: Targeted verification**

Run:

- `node --import tsx --test api/tests/workspace-packages.test.ts api/tests/onboarding-policy.test.ts api/tests/test-email-sink.test.ts`
- `node --import tsx --test tests/helpers/test-actors.test.ts tests/e2e/setup/worker-runtime.test.ts tests/e2e/fixtures/mailbox-providers.test.ts tests/e2e/setup/test-environment.test.ts tests/e2e/setup/global-setup.test.ts`
- `node --import tsx --test --test-concurrency=1 api/tests/integration/tenant-api-harness.integration.test.ts`
- `npm --workspace=@classroompath/react-spa exec vitest run src/views/__tests__/OnboardingPolicy.test.tsx`

**Step 2: Full verification**

Run: `npm run verify:commit`

Expected: PASS.

### Task 7: Commit

**Step 1: Commit**

Run:

- `git add contracts testkit package.json package-lock.json api react-spa tests docs/plans/2026-04-07-internal-packages-boundary-refactor.md scripts/build-classroompath.sh`
- `git commit -m "refactor(packages): extract contracts and testkit workspaces"`
