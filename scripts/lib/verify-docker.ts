import { createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { existsSync } from 'node:fs';

import type { VerifyPlan } from './verify-plan.ts';
import type { VerifyRuntime } from './verify-runtime.ts';

const DEFAULT_COMPOSE_PROJECT_NAME = 'classroompath_test';
const VERIFY_POSTGRES_CONTAINER_SUFFIX = '-postgres-1';
const VERIFY_DEFAULT_NETWORK_SUFFIX = '_default';

function buildTestDatabaseUrl(testDbPort: number): string {
  const protocol = 'postgres';
  const credentials = ['openpath', 'openpath_dev'].join(':');
  const host = 'localhost';
  const database = 'openpath';

  return `${protocol}://${credentials}@${host}:${String(testDbPort)}/${database}`;
}

function dockerComposeArgs(plan: VerifyPlan, args: string[]): string[] {
  return ['compose', '-p', plan.composeProjectName, '-f', plan.composeFile, ...args];
}

async function dockerCompose(
  plan: VerifyPlan,
  args: string[],
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  await runtime.run('docker', dockerComposeArgs(plan, args), { cwd: plan.rootDir, env });
}

async function dockerComposeForProject(
  plan: VerifyPlan,
  projectName: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  await runtime.run('docker', ['compose', '-p', projectName, '-f', plan.composeFile, ...args], {
    cwd: plan.rootDir,
    env,
  });
}

export function buildComposeProjectName(
  rootDir: string,
  requestedName = '',
  pid = process.pid
): string {
  const normalizedRequestedName = String(requestedName).trim();
  if (normalizedRequestedName && normalizedRequestedName !== DEFAULT_COMPOSE_PROJECT_NAME) {
    return normalizedRequestedName;
  }

  const projectChecksum = createHash('sha1').update(rootDir).digest('hex').slice(0, 8);
  return `${DEFAULT_COMPOSE_PROJECT_NAME}_${projectChecksum}_${pid}`;
}

function buildComposeProjectPrefix(rootDir: string, requestedName = ''): string {
  const normalizedRequestedName = String(requestedName).trim();
  if (normalizedRequestedName && normalizedRequestedName !== DEFAULT_COMPOSE_PROJECT_NAME) {
    return normalizedRequestedName;
  }

  const projectChecksum = createHash('sha1').update(rootDir).digest('hex').slice(0, 8);
  return `${DEFAULT_COMPOSE_PROJECT_NAME}_${projectChecksum}`;
}

function parseComposeProjectName(value: string, suffix: string): string | null {
  if (!value.endsWith(suffix)) {
    return null;
  }

  return value.slice(0, -suffix.length);
}

function listComposeProjectsForCleanup(
  plan: VerifyPlan,
  runtime: VerifyRuntime,
  captureArgs: string[],
  format: string,
  suffix: string
): string[] {
  const prefix = `${buildComposeProjectPrefix(plan.rootDir)}_`;
  const output = runtime.capture('docker', [...captureArgs, '--format', format], {
    cwd: plan.rootDir,
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith(prefix))
    .map((line) => parseComposeProjectName(line, suffix))
    .filter((projectName): projectName is string => Boolean(projectName))
    .filter((projectName) => projectName !== plan.composeProjectName);
}

export function discoverStaleVerifyComposeProjects(
  plan: VerifyPlan,
  runtime: VerifyRuntime
): string[] {
  const projects = new Set<string>();

  for (const projectName of listComposeProjectsForCleanup(
    plan,
    runtime,
    ['ps', '-a'],
    '{{.Names}}',
    VERIFY_POSTGRES_CONTAINER_SUFFIX
  )) {
    projects.add(projectName);
  }

  for (const projectName of listComposeProjectsForCleanup(
    plan,
    runtime,
    ['network', 'ls'],
    '{{.Name}}',
    VERIFY_DEFAULT_NETWORK_SUFFIX
  )) {
    projects.add(projectName);
  }

  return Array.from(projects).sort();
}

export function getVerifyEnv(plan: VerifyPlan): NodeJS.ProcessEnv {
  return {
    ...process.env,
    API_COVERAGE_BRANCHES: process.env.API_COVERAGE_BRANCHES ?? '70',
    API_COVERAGE_FUNCTIONS: process.env.API_COVERAGE_FUNCTIONS ?? '75',
    API_COVERAGE_LINES: process.env.API_COVERAGE_LINES ?? '80',
    API_COVERAGE_STATEMENTS: process.env.API_COVERAGE_STATEMENTS ?? '80',
    CI: 'true',
    COMPOSE_PROJECT_NAME: plan.composeProjectName,
    DATABASE_URL: buildTestDatabaseUrl(plan.testDbPort),
    JWT_SECRET: 'test-jwt-secret',
    TEST_DB_PORT: String(plan.testDbPort),
  };
}

export async function cleanupVerification(plan: VerifyPlan, runtime: VerifyRuntime): Promise<void> {
  if (existsSync(plan.composeFile)) {
    await dockerCompose(
      plan,
      ['down', '--volumes', '--remove-orphans'],
      process.env,
      runtime
    ).catch(() => undefined);
  }
}

export async function cleanupStaleVerificationProjects(
  plan: VerifyPlan,
  runtime: VerifyRuntime
): Promise<void> {
  if (!existsSync(plan.composeFile)) {
    return;
  }

  const staleProjects = discoverStaleVerifyComposeProjects(plan, runtime);
  if (staleProjects.length === 0) {
    return;
  }

  console.log(`Cleaning up stale verification compose projects: ${staleProjects.join(', ')}`);

  for (const projectName of staleProjects) {
    await dockerComposeForProject(
      plan,
      projectName,
      ['down', '--volumes', '--remove-orphans'],
      process.env,
      runtime
    ).catch(() => undefined);
  }
}

export async function pickTestDbPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolvePromise, rejectPromise) =>
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
  );

  if (!port) {
    throw new Error('Unable to allocate a temporary PostgreSQL port for verification');
  }

  return port;
}

export async function waitForTestPostgres(plan: VerifyPlan, runtime: VerifyRuntime): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const postgresReady = runtime.status(
      'docker',
      dockerComposeArgs(plan, [
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '-U',
        'openpath',
        '-d',
        'openpath',
      ])
    );
    const portReady = await new Promise<boolean>((resolvePromise) => {
      const client = connect({
        host: '127.0.0.1',
        port: plan.testDbPort,
      });
      const timeout = setTimeout(() => {
        client.destroy();
        resolvePromise(false);
      }, 1000);
      client.once('connect', () => {
        clearTimeout(timeout);
        client.end();
        resolvePromise(true);
      });
      client.once('error', () => {
        clearTimeout(timeout);
        resolvePromise(false);
      });
    });

    if (postgresReady && portReady) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error('PostgreSQL did not become healthy in time');
}
