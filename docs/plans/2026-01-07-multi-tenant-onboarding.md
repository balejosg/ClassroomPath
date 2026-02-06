# Multi-tenant Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-tenancy to ClassroomPath with organization-based isolation and onboarding flow for new users.

**Architecture:** ClassroomPath acts as a gateway layer on top of OpenPath (which remains single-tenant). ClassroomPath manages organizations and memberships in its own tables, and injects `organization_id` context into OpenPath queries via middleware. Users without organization membership see an onboarding screen.

**Tech Stack:** Express.js, tRPC, Drizzle ORM (PostgreSQL), TypeScript, Vite (SPA build extension)

---

## Prerequisites

- Node.js 20+
- PostgreSQL database (same as OpenPath, will add new tables)
- ClassroomPath repo cloned with OpenPath submodule initialized

---

## Phase 1: Database Schema (ClassroomPath Tables)

### Task 1.1: Create ClassroomPath Drizzle Configuration

**Files:**

- Create: `api/drizzle.config.ts`
- Create: `api/src/db/index.ts`
- Create: `api/src/db/schema.ts`

**Step 1: Create Drizzle config**

Create file `api/drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  tablesFilter: ['cp_*'], // Only manage ClassroomPath tables
});
```

**Step 2: Create database connection**

Create file `api/src/db/index.ts`:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { schema };
```

**Step 3: Create schema with organizations and memberships**

Create file `api/src/db/schema.ts`:

```typescript
import { pgTable, varchar, timestamp, unique } from 'drizzle-orm/pg-core';

// =============================================================================
// Organizations Table
// =============================================================================

export const cpOrganizations = pgTable('cp_organizations', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdBy: varchar('created_by', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Memberships Table
// =============================================================================

export const cpMemberships = pgTable(
  'cp_memberships',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    organizationId: varchar('organization_id', { length: 50 })
      .notNull()
      .references(() => cpOrganizations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(), // 'admin' | 'teacher' | 'student'
    invitedBy: varchar('invited_by', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('cp_memberships_user_org_key').on(table.userId, table.organizationId)]
);

// =============================================================================
// User Onboarding Status (tracks users who chose "wait for invitation")
// =============================================================================

export const cpUserStatus = pgTable('cp_user_status', {
  userId: varchar('user_id', { length: 50 }).primaryKey(),
  status: varchar('status', { length: 20 }).notNull(), // 'waiting' | 'active'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// =============================================================================
// Type Inference
// =============================================================================

export type Organization = typeof cpOrganizations.$inferSelect;
export type NewOrganization = typeof cpOrganizations.$inferInsert;

export type Membership = typeof cpMemberships.$inferSelect;
export type NewMembership = typeof cpMemberships.$inferInsert;

export type UserStatus = typeof cpUserStatus.$inferSelect;
export type NewUserStatus = typeof cpUserStatus.$inferInsert;
```

**Step 4: Commit**

```bash
git add api/drizzle.config.ts api/src/db/
git commit -m "feat(cp): add drizzle schema for organizations and memberships"
```

---

### Task 1.2: Generate and Run Migration

**Files:**

- Create: `api/drizzle/0000_*.sql` (generated)

**Step 1: Install dependencies**

```bash
cd api
npm init -y
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg typescript
```

**Step 2: Generate migration**

```bash
npx drizzle-kit generate
```

Expected: Creates `api/drizzle/0000_*.sql` with CREATE TABLE statements.

**Step 3: Run migration**

```bash
npx drizzle-kit push
```

Expected: Tables `cp_organizations`, `cp_memberships`, `cp_user_status` created in database.

**Step 4: Commit**

```bash
git add api/package*.json api/drizzle/
git commit -m "feat(cp): add database migration for multi-tenant tables"
```

---

## Phase 2: ClassroomPath API Layer

### Task 2.1: Create Express Server with tRPC

**Files:**

- Create: `api/src/server.ts`
- Create: `api/src/config.ts`
- Create: `api/src/lib/id.ts`

**Step 1: Create config**

Create file `api/src/config.ts`:

```typescript
export const config = {
  port: parseInt(process.env.CP_PORT ?? '3001', 10),
  openpathUrl: process.env.OPENPATH_API_URL ?? 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
};
```

**Step 2: Create ID generator utility**

Create file `api/src/lib/id.ts`:

```typescript
import { randomBytes } from 'crypto';

export function generateId(prefix: string = ''): string {
  const id = randomBytes(12).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}
```

**Step 3: Create Express server**

Create file `api/src/server.ts`:

```typescript
import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { config } from './config.js';

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  })
);

app.use(express.json());

// Health check
app.get('/cp/health', (_req, res) => {
  res.json({ status: 'ok', service: 'classroompath-gateway' });
});

// tRPC endpoints under /cp/trpc
app.use(
  '/cp/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

app.listen(config.port, () => {
  console.log(`ClassroomPath Gateway listening on port ${config.port}`);
});

export { app };
```

**Step 4: Commit**

```bash
git add api/src/
git commit -m "feat(cp): add express server skeleton"
```

---

### Task 2.2: Create tRPC Context and Router

**Files:**

- Create: `api/src/trpc/context.ts`
- Create: `api/src/trpc/trpc.ts`
- Create: `api/src/trpc/router.ts`

**Step 1: Create tRPC context**

Create file `api/src/trpc/context.ts`:

```typescript
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  roles: Array<{ role: string; groupIds: string[] }>;
}

export interface Context {
  user: JWTPayload | null;
  req: CreateExpressContextOptions['req'];
  res: CreateExpressContextOptions['res'];
}

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;
  let user: JWTPayload | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      user = jwt.verify(token, config.jwtSecret) as JWTPayload;
    } catch {
      // Invalid token, user remains null
    }
  }

  return { user, req, res };
}
```

**Step 2: Create tRPC instance**

Create file `api/src/trpc/trpc.ts`:

```typescript
import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

**Step 3: Create main router**

Create file `api/src/trpc/router.ts`:

```typescript
import { router } from './trpc.js';
import { onboardingRouter } from './routers/onboarding.js';

export const appRouter = router({
  onboarding: onboardingRouter,
});

export type AppRouter = typeof appRouter;
```

**Step 4: Commit**

```bash
git add api/src/trpc/
git commit -m "feat(cp): add tRPC infrastructure"
```

---

### Task 2.3: Create Onboarding Service

**Files:**

- Create: `api/src/services/onboarding.service.ts`

**Step 1: Create onboarding service**

Create file `api/src/services/onboarding.service.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';

export interface OnboardingStatus {
  hasMembership: boolean;
  isWaiting: boolean;
  organization: {
    id: string;
    name: string;
    role: string;
  } | null;
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  // Check for membership
  const membership = await db
    .select({
      orgId: schema.cpMemberships.organizationId,
      role: schema.cpMemberships.role,
      orgName: schema.cpOrganizations.name,
    })
    .from(schema.cpMemberships)
    .innerJoin(
      schema.cpOrganizations,
      eq(schema.cpMemberships.organizationId, schema.cpOrganizations.id)
    )
    .where(eq(schema.cpMemberships.userId, userId))
    .limit(1);

  if (membership.length > 0) {
    return {
      hasMembership: true,
      isWaiting: false,
      organization: {
        id: membership[0].orgId,
        name: membership[0].orgName,
        role: membership[0].role,
      },
    };
  }

  // Check if user is waiting
  const status = await db
    .select()
    .from(schema.cpUserStatus)
    .where(eq(schema.cpUserStatus.userId, userId))
    .limit(1);

  return {
    hasMembership: false,
    isWaiting: status.length > 0 && status[0].status === 'waiting',
    organization: null,
  };
}

export async function createOrganization(
  name: string,
  userId: string
): Promise<{ organizationId: string; membershipId: string }> {
  const orgId = generateId('org');
  const membershipId = generateId('mem');

  await db.transaction(async (tx) => {
    // Create organization
    await tx.insert(schema.cpOrganizations).values({
      id: orgId,
      name,
      createdBy: userId,
    });

    // Create admin membership for creator
    await tx.insert(schema.cpMemberships).values({
      id: membershipId,
      userId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: null,
    });

    // Remove waiting status if exists
    await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
  });

  return { organizationId: orgId, membershipId };
}

export async function setWaitingStatus(userId: string): Promise<void> {
  await db
    .insert(schema.cpUserStatus)
    .values({
      userId,
      status: 'waiting',
    })
    .onConflictDoUpdate({
      target: schema.cpUserStatus.userId,
      set: { status: 'waiting', updatedAt: new Date() },
    });
}

export async function clearWaitingStatus(userId: string): Promise<void> {
  await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
}
```

**Step 2: Commit**

```bash
git add api/src/services/
git commit -m "feat(cp): add onboarding service"
```

---

### Task 2.4: Create Onboarding Router

**Files:**

- Create: `api/src/trpc/routers/onboarding.ts`

**Step 1: Create onboarding router**

Create file `api/src/trpc/routers/onboarding.ts`:

```typescript
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as onboardingService from '../../services/onboarding.service.js';

export const onboardingRouter = router({
  /**
   * Get current user's onboarding status
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    return onboardingService.getOnboardingStatus(ctx.user.sub);
  }),

  /**
   * Create a new organization (user becomes admin)
   */
  createOrganization: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const status = await onboardingService.getOnboardingStatus(ctx.user.sub);

      if (status.hasMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'User already belongs to an organization',
        });
      }

      const result = await onboardingService.createOrganization(input.name, ctx.user.sub);

      return {
        success: true,
        organizationId: result.organizationId,
      };
    }),

  /**
   * Mark user as waiting for invitation
   */
  waitForInvitation: protectedProcedure.mutation(async ({ ctx }) => {
    const status = await onboardingService.getOnboardingStatus(ctx.user.sub);

    if (status.hasMembership) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User already belongs to an organization',
      });
    }

    await onboardingService.setWaitingStatus(ctx.user.sub);
    return { success: true };
  }),

  /**
   * Clear waiting status (user wants to create org instead)
   */
  cancelWaiting: protectedProcedure.mutation(async ({ ctx }) => {
    await onboardingService.clearWaitingStatus(ctx.user.sub);
    return { success: true };
  }),
});
```

**Step 2: Commit**

```bash
git add api/src/trpc/routers/
git commit -m "feat(cp): add onboarding tRPC router"
```

---

### Task 2.5: Add API Package Configuration

**Files:**

- Create: `api/package.json`
- Create: `api/tsconfig.json`

**Step 1: Create package.json**

Create file `api/package.json`:

```json
{
  "name": "@classroompath/api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@trpc/server": "^10.45.0",
    "cors": "^2.8.5",
    "drizzle-orm": "^0.38.0",
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.21.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

Create file `api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Install dependencies**

```bash
cd api
npm install
```

**Step 4: Commit**

```bash
git add api/package.json api/tsconfig.json
git commit -m "feat(cp): add api package configuration"
```

---

## Phase 3: SPA Onboarding Extension

### Task 3.1: Create Onboarding Module

**Files:**

- Create: `spa/src/onboarding.ts`
- Create: `spa/src/cp-trpc.ts`

**Step 1: Create ClassroomPath tRPC client**

Create file `spa/src/cp-trpc.ts`:

```typescript
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../api/src/trpc/router.js';

function getAuthToken(): string {
  return localStorage.getItem('openpath_access_token') ?? '';
}

export const cpTrpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/cp/trpc',
      headers() {
        const token = getAuthToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
```

**Step 2: Create onboarding module**

Create file `spa/src/onboarding.ts`:

```typescript
import { cpTrpc } from './cp-trpc.js';

export interface OnboardingState {
  hasMembership: boolean;
  isWaiting: boolean;
  organization: {
    id: string;
    name: string;
    role: string;
  } | null;
}

let currentStatus: OnboardingState | null = null;

export const onboarding = {
  async checkStatus(): Promise<OnboardingState> {
    try {
      const status = await cpTrpc.onboarding.status.query();
      currentStatus = status;
      return status;
    } catch (error) {
      console.error('Failed to check onboarding status:', error);
      // Assume no membership on error
      return { hasMembership: false, isWaiting: false, organization: null };
    }
  },

  getStatus(): OnboardingState | null {
    return currentStatus;
  },

  async createOrganization(name: string): Promise<boolean> {
    try {
      await cpTrpc.onboarding.createOrganization.mutate({ name });
      return true;
    } catch (error) {
      console.error('Failed to create organization:', error);
      return false;
    }
  },

  async waitForInvitation(): Promise<boolean> {
    try {
      await cpTrpc.onboarding.waitForInvitation.mutate();
      return true;
    } catch (error) {
      console.error('Failed to set waiting status:', error);
      return false;
    }
  },

  async cancelWaiting(): Promise<boolean> {
    try {
      await cpTrpc.onboarding.cancelWaiting.mutate();
      return true;
    } catch (error) {
      console.error('Failed to cancel waiting:', error);
      return false;
    }
  },

  initUI(): void {
    // Create organization form handler
    const createOrgForm = document.getElementById('create-org-form');
    createOrgForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('org-name-input') as HTMLInputElement;
      const name = input?.value?.trim();

      if (!name) return;

      const btn = document.getElementById('create-org-submit') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Creando...';

      const success = await this.createOrganization(name);

      if (success) {
        window.location.reload();
      } else {
        btn.disabled = false;
        btn.textContent = 'Crear organización';
        const error = document.getElementById('create-org-error');
        if (error) error.textContent = 'Error al crear la organización';
      }
    });

    // Wait for invitation button
    document.getElementById('wait-invite-btn')?.addEventListener('click', async () => {
      const success = await this.waitForInvitation();
      if (success) {
        showScreen('waiting-screen');
      }
    });

    // Reload button on waiting screen
    document.getElementById('reload-status-btn')?.addEventListener('click', () => {
      window.location.reload();
    });

    // Change mind button
    document.getElementById('change-mind-btn')?.addEventListener('click', async () => {
      await this.cancelWaiting();
      showScreen('onboarding-screen');
    });

    // Create org from waiting screen
    document.getElementById('create-org-from-waiting-btn')?.addEventListener('click', async () => {
      await this.cancelWaiting();
      showScreen('onboarding-screen');
    });
  },
};

function showScreen(screenId: string): void {
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.add('hidden');
  });
  document.getElementById(screenId)?.classList.remove('hidden');
}
```

**Step 3: Commit**

```bash
git add spa/src/
git commit -m "feat(cp): add onboarding SPA module"
```

---

### Task 3.2: Create Onboarding HTML Screens

**Files:**

- Create: `spa/onboarding-screens.html`

**Step 1: Create onboarding HTML partial**

Create file `spa/onboarding-screens.html`:

```html
<!-- Onboarding Screen (choose path) -->
<div id="onboarding-screen" class="screen hidden">
  <div class="onboarding-container">
    <div class="onboarding-header">
      <span class="logo-large">🎓</span>
      <h1>Bienvenido a ClassroomPath</h1>
      <p class="subtitle">Tu cuenta está lista. ¿Qué deseas hacer?</p>
    </div>

    <div class="onboarding-options">
      <div class="option-card" id="create-org-card">
        <span class="option-icon">🏫</span>
        <h2>Crear mi organización</h2>
        <p>Ideal si eres administrador de un centro educativo</p>

        <form id="create-org-form" class="create-org-form hidden">
          <div class="form-group">
            <label for="org-name-input">Nombre de la organización</label>
            <input
              type="text"
              id="org-name-input"
              placeholder="Ej: IES Ejemplo"
              minlength="2"
              maxlength="100"
              required
            />
          </div>
          <div id="create-org-error" class="error-message"></div>
          <button type="submit" id="create-org-submit" class="btn btn-primary btn-lg">
            Crear organización
          </button>
        </form>

        <button id="show-create-form-btn" class="btn btn-primary btn-lg">Crear organización</button>
      </div>

      <div class="option-card">
        <span class="option-icon">⏳</span>
        <h2>Esperar invitación</h2>
        <p>Si ya existe una organización y esperas que te inviten</p>
        <button id="wait-invite-btn" class="btn btn-secondary btn-lg">Esperar invitación</button>
      </div>
    </div>
  </div>
</div>

<!-- Waiting Screen -->
<div id="waiting-screen" class="screen hidden">
  <div class="waiting-container">
    <div class="waiting-header">
      <span class="waiting-icon">⏳</span>
      <h1>Esperando invitación</h1>
      <p>Cuando un administrador te invite a su organización, recarga esta página para acceder.</p>
    </div>

    <div class="waiting-actions">
      <button id="reload-status-btn" class="btn btn-primary btn-lg">🔄 Recargar página</button>
    </div>

    <hr class="divider" />

    <div class="change-mind">
      <p>¿Cambiaste de opinión?</p>
      <button id="create-org-from-waiting-btn" class="btn btn-link">
        Quiero crear mi propia organización
      </button>
    </div>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add spa/
git commit -m "feat(cp): add onboarding HTML screens"
```

---

### Task 3.3: Create Onboarding Styles

**Files:**

- Create: `spa/src/styles/onboarding.css`

**Step 1: Create onboarding styles**

Create file `spa/src/styles/onboarding.css`:

```css
/* Onboarding Container */
.onboarding-container,
.waiting-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.onboarding-header,
.waiting-header {
  margin-bottom: 2rem;
}

.logo-large {
  font-size: 4rem;
  display: block;
  margin-bottom: 1rem;
}

.waiting-icon {
  font-size: 4rem;
  display: block;
  margin-bottom: 1rem;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.subtitle {
  color: var(--color-text-muted);
  font-size: 1.1rem;
}

/* Option Cards */
.onboarding-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
}

.option-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: center;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.option-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.option-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 1rem;
}

.option-card h2 {
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
}

.option-card p {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

/* Create Org Form */
.create-org-form {
  margin-top: 1rem;
  text-align: left;
}

.create-org-form .form-group {
  margin-bottom: 1rem;
}

.create-org-form label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.create-org-form input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
}

/* Waiting Screen */
.waiting-actions {
  margin: 2rem 0;
}

.divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 2rem 0;
}

.change-mind {
  color: var(--color-text-muted);
}

.change-mind p {
  margin-bottom: 0.5rem;
}

/* Button sizes */
.btn-lg {
  padding: 0.875rem 1.5rem;
  font-size: 1rem;
}
```

**Step 2: Commit**

```bash
git add spa/src/styles/
git commit -m "feat(cp): add onboarding styles"
```

---

### Task 3.4: Integrate Onboarding into App Init

**Files:**

- Create: `spa/src/cp-init.ts`

**Step 1: Create ClassroomPath init wrapper**

Create file `spa/src/cp-init.ts`:

```typescript
/**
 * ClassroomPath Init Wrapper
 *
 * This module wraps OpenPath's init() to add onboarding check.
 * Import this instead of OpenPath's app-core when building ClassroomPath SPA.
 */

import { auth } from '../../upstream/openpath/spa/src/auth.js';
import { onboarding } from './onboarding.js';

// Re-export everything from OpenPath's app-core
export * from '../../upstream/openpath/spa/src/modules/app-core.js';

// Import the original init
import { init as openpathInit } from '../../upstream/openpath/spa/src/modules/app-core.js';

function showScreen(screenId: string): void {
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.add('hidden');
  });
  document.getElementById(screenId)?.classList.remove('hidden');
}

/**
 * ClassroomPath init - adds onboarding check before OpenPath init
 */
export async function init(): Promise<void> {
  // If not authenticated, let OpenPath handle login
  if (!auth.isAuthenticated()) {
    return openpathInit();
  }

  // Check onboarding status
  const status = await onboarding.checkStatus();

  if (!status.hasMembership) {
    // User has no organization - show onboarding
    onboarding.initUI();

    if (status.isWaiting) {
      showScreen('waiting-screen');
    } else {
      showScreen('onboarding-screen');

      // Setup show form button
      document.getElementById('show-create-form-btn')?.addEventListener('click', () => {
        document.getElementById('create-org-form')?.classList.remove('hidden');
        document.getElementById('show-create-form-btn')?.classList.add('hidden');
        document.getElementById('org-name-input')?.focus();
      });
    }
    return;
  }

  // User has organization - proceed with OpenPath
  console.log(`User belongs to org: ${status.organization?.name} as ${status.organization?.role}`);
  return openpathInit();
}
```

**Step 2: Commit**

```bash
git add spa/src/cp-init.ts
git commit -m "feat(cp): add init wrapper with onboarding check"
```

---

## Phase 4: Build Integration

### Task 4.1: Create ClassroomPath SPA Build Script

**Files:**

- Create: `spa/vite.config.ts`
- Create: `spa/package.json`

**Step 1: Create Vite config**

Create file `spa/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '../upstream/openpath/spa',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, '../upstream/openpath/spa/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      // Override OpenPath's app-core with our wrapper
      '@openpath/app-core': resolve(__dirname, 'src/cp-init.ts'),
    },
  },
  plugins: [
    // Plugin to inject onboarding screens into index.html
    {
      name: 'inject-onboarding-html',
      transformIndexHtml(html) {
        const onboardingHtml = require('fs').readFileSync(
          resolve(__dirname, 'onboarding-screens.html'),
          'utf-8'
        );
        // Insert before closing </body>
        return html.replace('</body>', `${onboardingHtml}\n</body>`);
      },
    },
  ],
});
```

**Step 2: Create package.json**

Create file `spa/package.json`:

```json
{
  "name": "@classroompath/spa",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@trpc/client": "^10.45.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 3: Commit**

```bash
git add spa/
git commit -m "feat(cp): add SPA build configuration"
```

---

### Task 4.2: Update Docker Compose for Dual Services

**Files:**

- Modify: `docker/docker-compose.yml`
- Create: `docker/Dockerfile.cp-api`

**Step 1: Create ClassroomPath API Dockerfile**

Create file `docker/Dockerfile.cp-api`:

```dockerfile
# ClassroomPath Gateway API
FROM node:20-alpine

WORKDIR /app

# Copy and install ClassroomPath API
COPY api/package*.json ./
RUN npm ci

COPY api/ ./

# Build
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/server.js"]
```

**Step 2: Update docker-compose.yml**

Replace file `docker/docker-compose.yml`:

```yaml
# ClassroomPath Docker Compose
# Gateway API + OpenPath API + SPA

services:
  # ClassroomPath Gateway API (handles multi-tenancy)
  gateway:
    build:
      context: ..
      dockerfile: docker/Dockerfile.cp-api
    container_name: classroompath-gateway
    restart: unless-stopped
    ports:
      - '3001:3001'
    environment:
      - CP_PORT=3001
      - OPENPATH_API_URL=http://api:3000
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - api
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3001/cp/health']
      interval: 30s
      timeout: 10s
      retries: 3

  # OpenPath API (core functionality)
  api:
    build:
      context: ../upstream/openpath
      dockerfile: ../../docker/Dockerfile.api
    container_name: classroompath-api
    restart: unless-stopped
    ports:
      - '3000:3000'
    env_file:
      - ../config/.env
    volumes:
      - api-data:/app/data
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  # SPA static server (nginx)
  spa:
    build:
      context: ..
      dockerfile: docker/Dockerfile.spa
    container_name: classroompath-spa
    restart: unless-stopped
    ports:
      - '8080:80'
    volumes:
      - ./spa-nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
      - gateway

volumes:
  api-data:
```

**Step 3: Commit**

```bash
git add docker/
git commit -m "feat(cp): add gateway service to docker-compose"
```

---

### Task 4.3: Update Nginx Config for Gateway Routing

**Files:**

- Modify: `docker/spa-nginx.conf`

**Step 1: Update nginx config**

Replace file `docker/spa-nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # ClassroomPath Gateway API
    location /cp/ {
        proxy_pass http://gateway:3001/cp/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # OpenPath API
    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # OpenPath tRPC
    location /trpc/ {
        proxy_pass http://api:3000/trpc/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # Whitelist files
    location /w/ {
        proxy_pass http://api:3000/w/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Step 2: Commit**

```bash
git add docker/spa-nginx.conf
git commit -m "feat(cp): add gateway routing to nginx config"
```

---

## Phase 5: Testing

### Task 5.1: Create Onboarding API Tests

**Files:**

- Create: `api/tests/onboarding.test.ts`

**Step 1: Create test file**

Create file `api/tests/onboarding.test.ts`:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db, schema } from '../src/db/index.js';
import { eq } from 'drizzle-orm';
import * as onboardingService from '../src/services/onboarding.service.js';

const TEST_USER_ID = 'test-user-' + Date.now();

describe('Onboarding Service', () => {
  after(async () => {
    // Cleanup
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, TEST_USER_ID));
    await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, TEST_USER_ID));
    // Note: org cleanup would cascade from memberships
  });

  it('should return no membership for new user', async () => {
    const status = await onboardingService.getOnboardingStatus(TEST_USER_ID);

    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, false);
    assert.strictEqual(status.organization, null);
  });

  it('should create organization and admin membership', async () => {
    const result = await onboardingService.createOrganization('Test School', TEST_USER_ID);

    assert.ok(result.organizationId.startsWith('org_'));
    assert.ok(result.membershipId.startsWith('mem_'));

    // Verify membership
    const status = await onboardingService.getOnboardingStatus(TEST_USER_ID);
    assert.strictEqual(status.hasMembership, true);
    assert.strictEqual(status.organization?.name, 'Test School');
    assert.strictEqual(status.organization?.role, 'admin');
  });

  it('should set waiting status', async () => {
    const waitingUserId = TEST_USER_ID + '-waiting';

    await onboardingService.setWaitingStatus(waitingUserId);

    const status = await onboardingService.getOnboardingStatus(waitingUserId);
    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, true);

    // Cleanup
    await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, waitingUserId));
  });

  it('should clear waiting status', async () => {
    const waitingUserId = TEST_USER_ID + '-clear';

    await onboardingService.setWaitingStatus(waitingUserId);
    await onboardingService.clearWaitingStatus(waitingUserId);

    const status = await onboardingService.getOnboardingStatus(waitingUserId);
    assert.strictEqual(status.isWaiting, false);
  });
});
```

**Step 2: Add test script to package.json**

Update `api/package.json` scripts:

```json
{
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts"
  }
}
```

**Step 3: Run tests**

```bash
cd api
npm test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add api/tests/ api/package.json
git commit -m "test(cp): add onboarding service tests"
```

---

## Phase 6: Documentation

### Task 6.1: Update ClassroomPath README

**Files:**

- Modify: `README.md`

**Step 1: Add multi-tenancy section to README**

Add to `README.md`:

```markdown
## Multi-tenancy

ClassroomPath adds organization-based multi-tenancy on top of OpenPath:

### User Flow

1. User logs in with Google (via OpenPath auth)
2. ClassroomPath checks for organization membership
3. If no membership:
   - Option A: Create new organization (becomes admin)
   - Option B: Wait for invitation
4. Once in an organization, user sees the OpenPath dashboard

### Database Tables

ClassroomPath adds these tables (prefixed with `cp_`):

| Table              | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `cp_organizations` | Organization records                      |
| `cp_memberships`   | User-organization associations with roles |
| `cp_user_status`   | Tracks users waiting for invitations      |

### API Endpoints

Gateway API runs on port 3001 with prefix `/cp/`:

| Endpoint                                 | Method | Description                      |
| ---------------------------------------- | ------ | -------------------------------- |
| `/cp/health`                             | GET    | Health check                     |
| `/cp/trpc/onboarding.status`             | GET    | Get user's org membership status |
| `/cp/trpc/onboarding.createOrganization` | POST   | Create new org                   |
| `/cp/trpc/onboarding.waitForInvitation`  | POST   | Set waiting status               |
| `/cp/trpc/onboarding.cancelWaiting`      | POST   | Clear waiting status             |
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs(cp): add multi-tenancy documentation"
```

---

### Task 6.2: Update Environment Example

**Files:**

- Modify: `config/.env.example`

**Step 1: Add ClassroomPath variables**

Add to `config/.env.example`:

```bash
# =============================================================================
# CLASSROOMPATH GATEWAY
# =============================================================================

# Port for the ClassroomPath gateway API
CP_PORT=3001

# Internal URL for OpenPath API (used by gateway)
OPENPATH_API_URL=http://api:3000
```

**Step 2: Commit**

```bash
git add config/.env.example
git commit -m "docs(cp): add gateway env variables to example"
```

---

## Summary

This plan implements multi-tenancy in ClassroomPath with:

1. **Database**: New tables `cp_organizations`, `cp_memberships`, `cp_user_status`
2. **Gateway API**: Express + tRPC server handling onboarding endpoints
3. **SPA Extension**: Onboarding screens and init wrapper
4. **Docker**: Updated compose with gateway service
5. **Nginx**: Routing for `/cp/*` to gateway

**Key architectural decisions:**

- OpenPath remains completely unchanged (single-tenant)
- ClassroomPath adds a gateway layer for multi-tenant features
- Users without membership see onboarding, not dashboard
- One user = one organization (no multi-org support per requirements)

---

**Total tasks:** 14
**Estimated time:** 4-6 hours
