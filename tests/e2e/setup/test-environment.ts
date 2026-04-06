import * as childProcess from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  deriveDatabaseComponentEnv,
  resolveDatabaseUrl,
} from '../../../api/src/lib/database-url.js';
import { clearTestEmailSink } from '../../../api/src/lib/test-email-sink.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type TestEnvironmentStepKind =
  | 'healthcheck'
  | 'clear-email-sink'
  | 'truncate'
  | 'openpath-db-push'
  | 'classroompath-db-push'
  | 'seed';

export interface TestEnvironmentStep {
  kind: TestEnvironmentStepKind;
}

export interface TestEnvironmentPlan {
  apiUrl: string;
  classroomPathApiDir: string;
  databaseUrl: string;
  externalBaseUrl: boolean;
  healthcheckAttempts: number;
  healthcheckDelayMs: number;
  openPathApiDir: string;
  steps: TestEnvironmentStep[];
}

export interface TestEnvironmentCommandRunner {
  execSync(command: string, options: childProcess.ExecSyncOptions): Buffer;
}

export interface TestEnvironmentDependencies {
  clearTestEmailSink?: () => Promise<void>;
  commandRunner?: TestEnvironmentCommandRunner;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof global.fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const defaultCommandRunner: TestEnvironmentCommandRunner = {
  execSync(command: string, options: childProcess.ExecSyncOptions): Buffer {
    return childProcess.execSync(command, options);
  },
};

function getHealthcheckAttempts(env: NodeJS.ProcessEnv): number {
  const attempts = Number.parseInt(env.E2E_SETUP_HEALTHCHECK_ATTEMPTS ?? '30', 10);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : 30;
}

function getHealthcheckDelayMs(env: NodeJS.ProcessEnv): number {
  const delayMs = Number.parseInt(env.E2E_SETUP_HEALTHCHECK_DELAY_MS ?? '1000', 10);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 1000;
}

function shouldSkipDbPush(env: NodeJS.ProcessEnv): boolean {
  const raw = env.E2E_SKIP_DB_PUSH;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isExternalBaseUrl(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.BASE_URL;
  if (!baseUrl) return false;
  return !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
}

function buildTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return resolveDatabaseUrl(env, { database: 'classroompath_test' });
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export function buildTestEnvironmentPlan(
  env: NodeJS.ProcessEnv = process.env
): TestEnvironmentPlan {
  const apiUrl = env.OPENPATH_API_URL ?? 'http://localhost:3010';
  const externalBaseUrl = isExternalBaseUrl(env);
  const classroomPathApiDir = join(__dirname, '..', '..', '..', 'api');
  const openPathApiDir = join(__dirname, '..', '..', '..', 'upstream', 'openpath', 'api');
  const steps: TestEnvironmentStep[] = externalBaseUrl
    ? []
    : [
        { kind: 'healthcheck' },
        { kind: 'clear-email-sink' },
        { kind: 'truncate' },
        { kind: 'openpath-db-push' },
        ...(shouldSkipDbPush(env) ? [] : ([{ kind: 'classroompath-db-push' }] as const)),
        { kind: 'seed' },
      ];

  return {
    apiUrl,
    classroomPathApiDir,
    databaseUrl: env.DATABASE_URL ?? buildTestDatabaseUrl(env),
    externalBaseUrl,
    healthcheckAttempts: getHealthcheckAttempts(env),
    healthcheckDelayMs: getHealthcheckDelayMs(env),
    openPathApiDir,
    steps,
  };
}

async function runHealthcheck(
  plan: TestEnvironmentPlan,
  deps: Required<Pick<TestEnvironmentDependencies, 'fetch' | 'sleep'>>
): Promise<void> {
  let apiReady = false;

  for (let i = 0; i < plan.healthcheckAttempts; i += 1) {
    try {
      const response = await deps.fetch(`${plan.apiUrl}/health`);
      if (response.ok) {
        apiReady = true;
        break;
      }
    } catch {
      // API not ready yet.
    }
    await deps.sleep(plan.healthcheckDelayMs);
  }

  if (!apiReady) {
    throw new Error(`E2E global setup failed: OpenPath API not ready at ${plan.apiUrl}/health`);
  }
}

function runCommandStep(
  step: TestEnvironmentStepKind,
  plan: TestEnvironmentPlan,
  env: NodeJS.ProcessEnv,
  commandRunner: TestEnvironmentCommandRunner
): void {
  switch (step) {
    case 'truncate':
      commandRunner.execSync('npm run db:seed:e2e', {
        cwd: plan.classroomPathApiDir,
        env: {
          ...env,
          DATABASE_URL: plan.databaseUrl,
          E2E_TRUNCATE_ONLY: '1',
        },
        stdio: 'inherit',
      });
      return;
    case 'openpath-db-push': {
      const database = deriveDatabaseComponentEnv(
        { ...env, DATABASE_URL: plan.databaseUrl },
        { database: 'classroompath_test' }
      );
      commandRunner.execSync('npx drizzle-kit push --force', {
        cwd: plan.openPathApiDir,
        env: {
          ...env,
          DATABASE_URL: plan.databaseUrl,
          ...database,
        },
        stdio: 'inherit',
      });
      return;
    }
    case 'classroompath-db-push':
      commandRunner.execSync('npx drizzle-kit push --force', {
        cwd: plan.classroomPathApiDir,
        env: {
          ...env,
          DATABASE_URL: plan.databaseUrl,
        },
        stdio: 'inherit',
      });
      return;
    case 'seed':
      commandRunner.execSync('npm run db:seed:e2e', {
        cwd: plan.classroomPathApiDir,
        env: {
          ...env,
          DATABASE_URL: plan.databaseUrl,
        },
        stdio: 'inherit',
      });
      return;
    default:
      return;
  }
}

export async function prepareTestEnvironment(
  deps: TestEnvironmentDependencies = {}
): Promise<TestEnvironmentPlan> {
  const env = deps.env ?? process.env;
  const plan = buildTestEnvironmentPlan(env);
  const fetchImpl = deps.fetch ?? global.fetch;
  const sleepImpl = deps.sleep ?? sleep;
  const clearEmailSink = deps.clearTestEmailSink ?? clearTestEmailSink;
  const commandRunner = deps.commandRunner ?? defaultCommandRunner;

  if (plan.externalBaseUrl) {
    return plan;
  }

  if (!fetchImpl) {
    throw new Error('E2E global setup failed: fetch is not available');
  }

  for (const step of plan.steps) {
    switch (step.kind) {
      case 'healthcheck':
        await runHealthcheck(plan, { fetch: fetchImpl, sleep: sleepImpl });
        break;
      case 'clear-email-sink':
        await clearEmailSink();
        break;
      case 'truncate':
        try {
          runCommandStep(step.kind, plan, env, commandRunner);
        } catch (error) {
          throw new Error(
            `E2E global setup failed: pre-seed truncate failed: ${formatError(error)}`
          );
        }
        break;
      case 'openpath-db-push':
        try {
          runCommandStep(step.kind, plan, env, commandRunner);
        } catch (error) {
          throw new Error(
            `E2E global setup failed: OpenPath db:push failed: ${formatError(error)}`
          );
        }
        break;
      case 'classroompath-db-push':
        try {
          runCommandStep(step.kind, plan, env, commandRunner);
        } catch (error) {
          throw new Error(
            `E2E global setup failed: ClassroomPath db:push failed: ${formatError(error)}`
          );
        }
        break;
      case 'seed':
        try {
          runCommandStep(step.kind, plan, env, commandRunner);
        } catch (error) {
          throw new Error(`E2E global setup failed: seed script failed: ${formatError(error)}`);
        }
        break;
    }
  }

  return plan;
}
