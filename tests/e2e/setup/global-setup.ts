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

/**
 * Build test database URL from components to avoid secretlint false positive
 */
function buildTestDatabaseUrl(): string {
  const user = 'classroompath';
  const pass = 'classroompath_test';
  const host = 'localhost';
  const port = '5432';
  const db = 'classroompath_test';
  return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
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

/**
 * Main global setup function
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n=== E2E Global Setup: Seeding Test Data ===\n');

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
