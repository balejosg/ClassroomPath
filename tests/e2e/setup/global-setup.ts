import { FullConfig } from '@playwright/test';
import { clearTestEmailSink } from '@classroompath/testkit/test-email-sink';
import { defaultCommandRunner, prepareTestEnvironment } from './test-environment.js';

export const commandRunner = defaultCommandRunner;

/**
 * Main global setup function
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n=== E2E Global Setup: Seeding Test Data ===\n');
  const plan = await prepareTestEnvironment({
    clearTestEmailSink,
    commandRunner,
    env: process.env,
    fetch: global.fetch,
  });

  if (plan.externalBaseUrl) {
    console.log('External BASE_URL detected; skipping local db:push + seed.');
    console.log('\n=== E2E Global Setup Complete ===\n');
    return;
  }

  console.log('\n=== E2E Global Setup Complete ===\n');
}

export default globalSetup;
