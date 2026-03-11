/**
 * Playwright Global Setup
 *
 * Seeds the database with test accounts before E2E tests run.
 * Uses the seed-e2e.ts script which properly sets up:
 * - Admin user with organization
 * - Teacher user as member of admin's organization
 * - Pending user in waiting state
 */

import { FullConfig } from '@playwright/test';
import * as childProcess from 'node:child_process';
import { join, dirname } from 'path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = process.env.OPENPATH_API_URL ?? 'http://localhost:3010';

export const commandRunner = {
  execSync(command: string, options: childProcess.ExecSyncOptions): Buffer {
    return childProcess.execSync(command, options);
  },
};

function getHealthcheckAttempts(): number {
  const attempts = Number.parseInt(process.env.E2E_SETUP_HEALTHCHECK_ATTEMPTS ?? '30', 10);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 30;
}

function getHealthcheckDelayMs(): number {
  const delayMs = Number.parseInt(process.env.E2E_SETUP_HEALTHCHECK_DELAY_MS ?? '1000', 10);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 1000;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function shouldSkipDbPush(): boolean {
  const raw = process.env.E2E_SKIP_DB_PUSH;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isExternalBaseUrl(): boolean {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) return false;
  return !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
}

/**
 * Build test database URL from components to avoid secretlint false positive
 */
function getTestDatabaseConfig(): {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  // Use the owner user for schema pushes (drizzle-kit requires table ownership).
  // The test user can still be granted privileges separately if needed.
  return {
    user: process.env.DB_USER ?? 'openpath',
    password: process.env.DB_PASSWORD ?? 'openpath_dev',
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ?? '5432',
    database: process.env.DB_NAME ?? 'classroompath_test',
  };
}

function buildTestDatabaseUrl(): string {
  const { user, password, host, port, database } = getTestDatabaseConfig();
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

/**
 * Runs the seed-e2e.ts script to properly set up all test data
 */
async function runSeedScript(): Promise<void> {
  const apiDir = join(__dirname, '..', '..', '..', 'api');

  try {
    console.log('Running seed-e2e.ts script...');
    commandRunner.execSync('npm run db:seed:e2e', {
      cwd: apiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Ensure DATABASE_URL is set for the seed script
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
      },
    });
    console.log('Seed script completed successfully');
  } catch (error) {
    throw new Error(`E2E global setup failed: seed script failed: ${formatError(error)}`);
  }
}

async function runTruncateOnly(): Promise<void> {
  const apiDir = join(__dirname, '..', '..', '..', 'api');

  try {
    console.log('Truncating E2E tables (pre-push cleanup)...');
    commandRunner.execSync('npm run db:seed:e2e', {
      cwd: apiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
        E2E_TRUNCATE_ONLY: '1',
      },
    });
    console.log('Truncate-only completed successfully');
  } catch (error) {
    throw new Error(`E2E global setup failed: pre-seed truncate failed: ${formatError(error)}`);
  }
}

/**
 * Ensures ClassroomPath (cp_*) tables are up to date before seeding.
 */
async function runClassroomPathDbPush(): Promise<void> {
  const apiDir = join(__dirname, '..', '..', '..', 'api');

  try {
    console.log('Running drizzle-kit push --force for cp_* tables...');
    commandRunner.execSync('npx drizzle-kit push --force', {
      cwd: apiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
      },
    });
    console.log('db:push completed successfully');
  } catch (error) {
    throw new Error(`E2E global setup failed: ClassroomPath db:push failed: ${formatError(error)}`);
  }
}

async function runOpenPathDbPush(): Promise<void> {
  const openPathApiDir = join(__dirname, '..', '..', '..', 'upstream', 'openpath', 'api');
  const database = getTestDatabaseConfig();

  try {
    console.log('Running OpenPath drizzle-kit push --force for shared test DB...');
    commandRunner.execSync('npx drizzle-kit push --force', {
      cwd: openPathApiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
        DB_HOST: database.host,
        DB_PORT: database.port,
        DB_NAME: database.database,
        DB_USER: database.user,
        DB_PASSWORD: database.password,
      },
    });
    console.log('OpenPath db:push completed successfully');
  } catch (error) {
    throw new Error(`E2E global setup failed: OpenPath db:push failed: ${formatError(error)}`);
  }
}

/**
 * Main global setup function
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n=== E2E Global Setup: Seeding Test Data ===\n');

  // For external environments (staging/prod), never attempt local DB mutations.
  if (isExternalBaseUrl()) {
    console.log('External BASE_URL detected; skipping local db:push + seed.');
    console.log('\n=== E2E Global Setup Complete ===\n');
    return;
  }

  // Wait for API to be ready
  let apiReady = false;
  const healthcheckAttempts = getHealthcheckAttempts();
  const healthcheckDelayMs = getHealthcheckDelayMs();

  for (let i = 0; i < healthcheckAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        apiReady = true;
        break;
      }
    } catch {
      // API not ready yet
    }
    await sleep(healthcheckDelayMs);
  }

  if (!apiReady) {
    throw new Error(`E2E global setup failed: OpenPath API not ready at ${API_URL}/health`);
  }

  // Ensure tables are empty so seeding is deterministic and db:push never prompts.
  await runTruncateOnly();

  await runOpenPathDbPush();

  if (shouldSkipDbPush()) {
    console.log('Skipping db:push (E2E_SKIP_DB_PUSH is enabled)');
  } else {
    await runClassroomPathDbPush();
  }

  // Run the seed script which properly sets up:
  // - Admin user with organization
  // - Teacher user as member of admin's organization
  // - Pending user in waiting state
  await runSeedScript();

  console.log('\n=== E2E Global Setup Complete ===\n');
}

export default globalSetup;
