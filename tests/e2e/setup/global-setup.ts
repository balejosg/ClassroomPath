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
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = process.env.OPENPATH_API_URL ?? 'http://localhost:3010';

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
async function runSeedScript(): Promise<boolean> {
  const apiDir = join(__dirname, '..', '..', '..', 'api');

  try {
    console.log('Running seed-e2e.ts script...');
    execSync('npm run db:seed:e2e', {
      cwd: apiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Ensure DATABASE_URL is set for the seed script
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
      },
    });
    console.log('Seed script completed successfully');
    return true;
  } catch (error) {
    console.error('Failed to run seed script:', error);
    return false;
  }
}

async function runTruncateOnly(): Promise<boolean> {
  const apiDir = join(__dirname, '..', '..', '..', 'api');

  try {
    console.log('Truncating E2E tables (pre-push cleanup)...');
    execSync('npm run db:seed:e2e', {
      cwd: apiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
        E2E_TRUNCATE_ONLY: '1',
      },
    });
    console.log('Truncate-only completed successfully');
    return true;
  } catch (error) {
    console.error('Failed to truncate E2E tables:', error);
    return false;
  }
}

/**
 * Ensures ClassroomPath (cp_*) tables are up to date before seeding.
 */
async function runClassroomPathDbPush(): Promise<boolean> {
  const apiDir = join(__dirname, '..', '..', '..', 'api');

  try {
    console.log('Running drizzle-kit push --force for cp_* tables...');
    execSync('npx drizzle-kit push --force', {
      cwd: apiDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? buildTestDatabaseUrl(),
      },
    });
    console.log('db:push completed successfully');
    return true;
  } catch (error) {
    console.error('Failed to run db:push:', error);
    return false;
  }
}

async function runOpenPathDbPush(): Promise<boolean> {
  const openPathApiDir = join(__dirname, '..', '..', '..', 'upstream', 'openpath', 'api');
  const database = getTestDatabaseConfig();

  try {
    console.log('Running OpenPath drizzle-kit push --force for shared test DB...');
    execSync('npx drizzle-kit push --force', {
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
    return true;
  } catch (error) {
    console.error('Failed to run OpenPath db:push:', error);
    return false;
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
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        apiReady = true;
        break;
      }
    } catch {
      // API not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!apiReady) {
    console.warn('WARNING: API not responding, skipping seed setup');
    return;
  }

  // Ensure tables are empty so seeding is deterministic and db:push never prompts.
  const truncateSuccess = await runTruncateOnly();
  if (!truncateSuccess) {
    console.warn('WARNING: Pre-push truncate failed; seed may be non-deterministic');
  }

  const openPathPushSuccess = await runOpenPathDbPush();
  if (!openPathPushSuccess) {
    console.warn(
      'WARNING: OpenPath db:push failed; registration flows may fail due to schema mismatch'
    );
  }

  if (shouldSkipDbPush()) {
    console.log('Skipping db:push (E2E_SKIP_DB_PUSH is enabled)');
  } else {
    const pushSuccess = await runClassroomPathDbPush();
    if (!pushSuccess) {
      console.warn('WARNING: db:push failed, seed may fail due to schema mismatch');
    }
  }

  // Run the seed script which properly sets up:
  // - Admin user with organization
  // - Teacher user as member of admin's organization
  // - Pending user in waiting state
  const seedSuccess = await runSeedScript();

  if (!seedSuccess) {
    console.warn('WARNING: Seed script failed, tests may fail due to missing data');
  }

  console.log('\n=== E2E Global Setup Complete ===\n');
}

export default globalSetup;
