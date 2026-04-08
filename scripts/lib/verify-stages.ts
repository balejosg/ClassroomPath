import { createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { VerifyPlan } from './verify-plan.ts';

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type VerifyRuntime = {
  capture: (cmd: string, args: string[], options?: RunOptions) => string;
  run: (cmd: string, args: string[], options?: RunOptions) => Promise<void>;
  runParallel: (commands: string[], options?: RunOptions) => Promise<void>;
  runShell: (command: string, options?: RunOptions) => Promise<void>;
  status: (cmd: string, args: string[], options?: RunOptions) => boolean;
};

const DEFAULT_COMPOSE_PROJECT_NAME = 'classroompath_test';

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

export function hasPlaywrightBrowsers(playwrightCacheDir: string): boolean {
  return (
    existsSync(playwrightCacheDir) &&
    readdirSync(playwrightCacheDir).some((entry) => entry.startsWith('chromium-'))
  );
}

export function needsOpenPathWorkspaceInstall(openPathRootDir: string): boolean {
  const installMarkerPath = join(openPathRootDir, 'node_modules/.package-lock.json');
  const lockfilePath = join(openPathRootDir, 'package-lock.json');

  if (!existsSync(lockfilePath)) {
    throw new Error(`OpenPath package-lock.json not found at ${lockfilePath}`);
  }

  if (!existsSync(installMarkerPath)) {
    return true;
  }

  return statSync(installMarkerPath).mtimeMs < statSync(lockfilePath).mtimeMs;
}

export async function ensureOpenPathWorkspaceInstall(
  rootDir: string,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  const openPathRootDir = resolve(rootDir, 'upstream/openpath');

  if (!needsOpenPathWorkspaceInstall(openPathRootDir)) {
    return;
  }

  console.log('Bootstrapping OpenPath workspace dependencies...');
  await runtime.run('npm', ['ci'], { cwd: openPathRootDir, env });
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

async function waitForTestPostgres(plan: VerifyPlan, runtime: VerifyRuntime): Promise<void> {
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

function validatePlaywrightReport(reportPath: string): void {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    stats?: { skipped?: number };
  };
  const skipped = Number(report?.stats?.skipped ?? 0);

  if (!Number.isFinite(skipped)) {
    throw new Error('Playwright JSON report did not contain a numeric skipped count.');
  }

  if (skipped > 0) {
    throw new Error(`Playwright verification cannot skip tests; skipped: ${String(skipped)}`);
  }
}

async function runPlaywrightVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  const reportDir = mkdtempSync(join(tmpdir(), 'classroompath-playwright-report-'));
  const reportPath = join(reportDir, 'report.json');

  try {
    await runtime.run('npx', ['playwright', 'test'], {
      cwd: plan.rootDir,
      env: {
        ...env,
        E2E_SKIP_DB_PUSH: '1',
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        PLAYWRIGHT_WORKERS: String(plan.playwrightWorkers),
      },
    });
    validatePlaywrightReport(reportPath);
  } finally {
    rmSync(reportDir, { force: true, recursive: true });
  }
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
    await dockerCompose(plan, ['stop'], process.env, runtime).catch(() => undefined);
  }
}

export async function runReleaseAutomationVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ⚡ OPTIMIZATION: Release automation-only diff detected');
  console.log(
    '  → Running targeted workflow/release regression instead of full product verification'
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  console.log('[1/2] Format and secret checks...');
  await runtime.runParallel(['npm run format:check', 'npm run security:secrets'], {
    cwd: plan.rootDir,
    env,
  });

  console.log('');
  console.log('[2/2] Release automation regression...');
  await runtime.run('npm', ['run', 'test:release-automation'], {
    cwd: plan.rootDir,
    env,
  });
}

export async function runFullVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  console.log('[0/5] Checking test file coverage...');
  await runtime.run('bash', ['scripts/check-test-files.sh'], { cwd: plan.rootDir, env });
  await runtime.run('npm', ['run', 'verify:migrations:metadata'], { cwd: plan.rootDir, env });

  console.log('Starting PostgreSQL (test)...');
  await dockerCompose(plan, ['up', '-d', 'postgres'], env, runtime);

  console.log('');
  console.log('[1/5] Building all packages...');
  await ensureOpenPathWorkspaceInstall(plan.rootDir, env, runtime);
  await runtime.run('npm', ['run', 'build'], { cwd: plan.rootDir, env });

  console.log('Waiting for PostgreSQL...');
  await waitForTestPostgres(plan, runtime);

  runtime
    .capture('node', [join(plan.rootDir, 'scripts/derive-openpath-db-env.mjs')], {
      cwd: plan.rootDir,
      env,
    })
    .split('\n')
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^export ([A-Z0-9_]+)=(.*)$/);
      if (match) {
        env[match[1]] = JSON.parse(match[2]);
      }
    });

  console.log('');
  console.log('[2/5] Static analysis (parallel: typecheck, lint, format)...');
  await runtime.run('bash', ['scripts/run-turbo.sh', 'verify:static'], {
    cwd: plan.rootDir,
    env,
  });
  if (!plan.skipOpenPathStatic) {
    await runtime.runShell('cd upstream/openpath && npm run verify:static', {
      cwd: plan.rootDir,
      env,
    });
  }
  await runtime.run('npm', ['run', 'format:check'], { cwd: plan.rootDir, env });

  console.log('');
  console.log('[3/5] Security and size checks (parallel)...');
  if (plan.skipOpenPathStatic) {
    await runtime.run('npm', ['audit', '--audit-level=high'], { cwd: plan.rootDir, env });
  } else {
    await runtime.runParallel(
      ['npm run security:audit', 'npm run security:secrets', 'npm run size:check'],
      {
        cwd: plan.rootDir,
        env,
      }
    );
  }

  console.log('');
  console.log('[4/5] Running tests...');
  console.log('Running migrations...');
  await runtime.run(
    'npm',
    ['run', 'db:push', '--workspace=@classroompath/api', '--workspace=@openpath/api'],
    {
      cwd: plan.rootDir,
      env,
    }
  );

  if (plan.needsCoverageGate) {
    rmSync(join(plan.rootDir, 'api/coverage'), { force: true, recursive: true });
    rmSync(join(plan.rootDir, 'api/.nyc_output'), { force: true, recursive: true });
    rmSync(join(plan.rootDir, 'react-spa/coverage'), { force: true, recursive: true });
    rmSync(join(plan.rootDir, 'react-spa/.nyc_output'), { force: true, recursive: true });
  }

  const spaCommand = plan.needsSpaCoverage
    ? 'npm run test:coverage --workspace=@classroompath/react-spa'
    : 'npm run test --workspace=@classroompath/react-spa';
  const apiCommand = plan.needsApiCoverage
    ? 'npm run test:coverage --workspace=@classroompath/api'
    : 'npm run test --workspace=@classroompath/api';

  const spaPromise = runtime.runShell(spaCommand, { cwd: plan.rootDir, env });
  await runtime.runShell(apiCommand, { cwd: plan.rootDir, env });
  if (!plan.needsApiCoverage) {
    await runtime.runShell('npm run test:integration --workspace=@classroompath/api', {
      cwd: plan.rootDir,
      env,
    });
  }
  await spaPromise;

  console.log('Running Playwright setup hard-failure tests...');
  await runtime.run(
    'node',
    [
      '--import',
      'tsx',
      '--test',
      'tests/e2e/setup/global-setup.test.ts',
      'tests/e2e/setup/test-environment.test.ts',
      'tests/e2e/fixtures/mailbox-providers.test.ts',
    ],
    {
      cwd: plan.rootDir,
      env,
    }
  );

  console.log('');
  console.log('[4/5] Checking coverage on changed files (if any)...');
  if (plan.needsCoverageGate) {
    await runtime.run('node', ['scripts/check-new-file-coverage.js'], {
      cwd: plan.rootDir,
      env,
    });
  } else {
    console.log('Skipping coverage gate (no changed API/SPA source files).');
  }

  console.log('');
  console.log('[5/5] E2E Playwright tests...');
  if (!plan.browsersAvailable) {
    throw new Error(
      `Playwright browsers are required for local verification and are not installed. Cache: ${plan.playwrightCacheDir}`
    );
  }

  await runtime
    .run('docker', ['stop', 'openpath-api'], { cwd: plan.rootDir, env })
    .catch(() => undefined);
  await runtime.runShell(
    'for port in 3001 3010 5173; do pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP \'pid=\\K\\d+\' | head -1 || true); if [ -n "$pid" ]; then echo "Killing orphaned process on port $port (PID: $pid)"; kill "$pid" 2>/dev/null || true; fi; done',
    { cwd: plan.rootDir, env }
  );

  console.log(`Using Playwright workers: ${String(plan.playwrightWorkers)}`);
  console.log('Running full E2E Playwright suite...');
  await runPlaywrightVerification(plan, env, runtime);
}
