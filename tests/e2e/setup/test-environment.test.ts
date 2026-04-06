import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';

import {
  buildTestEnvironmentPlan,
  prepareTestEnvironment,
  type TestEnvironmentDependencies,
} from './test-environment.js';

const ORIGINAL_ENV = { ...process.env };

describe('test environment runner', () => {
  beforeEach(() => {
    mock.restoreAll();
    const nextEnv = {
      ...ORIGINAL_ENV,
      BASE_URL: 'http://localhost:5173',
      OPENPATH_API_URL: 'http://127.0.0.1:3010',
      E2E_SETUP_HEALTHCHECK_ATTEMPTS: '1',
      E2E_SETUP_HEALTHCHECK_DELAY_MS: '0',
    };
    delete nextEnv.E2E_SKIP_DB_PUSH;
    process.env = nextEnv;
  });

  afterEach(() => {
    mock.restoreAll();
    process.env = { ...ORIGINAL_ENV };
  });

  test('builds a declarative local execution plan', () => {
    const plan = buildTestEnvironmentPlan(process.env);

    assert.equal(plan.externalBaseUrl, false);
    assert.equal(plan.apiUrl, 'http://127.0.0.1:3010');
    assert.deepEqual(
      plan.steps.map((step) => step.kind),
      [
        'healthcheck',
        'clear-email-sink',
        'truncate',
        'openpath-db-push',
        'classroompath-db-push',
        'seed',
      ]
    );
  });

  test('drops classroompath db:push from the plan when E2E_SKIP_DB_PUSH is enabled', () => {
    const plan = buildTestEnvironmentPlan({
      ...process.env,
      E2E_SKIP_DB_PUSH: '1',
    });

    assert.deepEqual(
      plan.steps.map((step) => step.kind),
      ['healthcheck', 'clear-email-sink', 'truncate', 'openpath-db-push', 'seed']
    );
  });

  test('executes the planned local setup steps in order', async () => {
    const calls: string[] = [];
    const deps: TestEnvironmentDependencies = {
      env: process.env,
      fetch: mock.fn(async () => ({ ok: true }) as Response) as typeof fetch,
      sleep: mock.fn(async () => undefined),
      clearTestEmailSink: mock.fn(async () => {
        calls.push('clear-email-sink');
      }),
      commandRunner: {
        execSync(command) {
          calls.push(command);
          return Buffer.from('');
        },
      },
    };

    await prepareTestEnvironment(deps);

    assert.deepEqual(calls, [
      'clear-email-sink',
      'npm run db:seed:e2e',
      'npx drizzle-kit push --force',
      'npx drizzle-kit push --force',
      'npm run db:seed:e2e',
    ]);
  });
});
