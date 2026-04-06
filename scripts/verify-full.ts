import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type VerifyMode = 'commit' | 'release';

type VerifyPlan = {
  browsersAvailable: boolean;
  composeFile: string;
  composeProjectName: string;
  mode: VerifyMode;
  needsApiCoverage: boolean;
  needsCoverageGate: boolean;
  needsSpaCoverage: boolean;
  playwrightCacheDir: string;
  playwrightWorkers: number;
  rootDir: string;
  skipOpenPathStatic: boolean;
  submoduleOnly: boolean;
  testDbPort: number;
};

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const COMPOSE_FILE = join(ROOT_DIR, 'docker/docker-compose.test.yml');
const DEFAULT_COMPOSE_PROJECT_NAME = 'classroompath_test';

function resolveVerifyMode(env: NodeJS.ProcessEnv): VerifyMode {
  return env.VERIFY_MODE === 'release' ? 'release' : 'commit';
}

function capture(cmd: string, args: string[], options: RunOptions = {}): string {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? ROOT_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${cmd} failed`).trim());
  }

  return (result.stdout ?? '').trim();
}

function status(cmd: string, args: string[], options: RunOptions = {}): boolean {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? ROOT_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: 'ignore',
  });

  return result.status === 0;
}

function run(cmd: string, args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? ROOT_DIR,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${cmd} ${args.join(' ')} exited with code ${String(code)}`));
    });
  });
}

function runShell(command: string, options: RunOptions = {}): Promise<void> {
  return run('bash', ['-lc', command], options);
}

async function runParallel(commands: string[]): Promise<void> {
  await Promise.all(commands.map((command) => runShell(command)));
}

async function pickTestDbPort(): Promise<number> {
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

function getStagedFiles(diffFilter?: string): string[] {
  const args = ['diff', '--cached', '--name-only'];
  if (diffFilter) {
    args.push(`--diff-filter=${diffFilter}`);
  }

  const output = capture('git', args);
  return output ? output.split('\n').filter(Boolean) : [];
}

function detectSubmoduleOnly(stagedFiles: string[]): {
  submoduleOnly: boolean;
  skipOpenPathStatic: boolean;
} {
  if (stagedFiles.length === 0) {
    return { submoduleOnly: false, skipOpenPathStatic: false };
  }

  const nonSubmoduleFiles = stagedFiles.filter((entry) => entry !== 'upstream/openpath');
  const submoduleOnly = nonSubmoduleFiles.length === 0;

  return {
    submoduleOnly,
    skipOpenPathStatic: submoduleOnly,
  };
}

function detectCoverageNeeds(stagedFiles: string[]): {
  needsApiCoverage: boolean;
  needsCoverageGate: boolean;
  needsSpaCoverage: boolean;
} {
  if (stagedFiles.length === 0) {
    return {
      needsApiCoverage: true,
      needsCoverageGate: true,
      needsSpaCoverage: true,
    };
  }

  const needsApiCoverage = stagedFiles.some((entry) => /^api\/src\/.*\.(ts|tsx)$/.test(entry));
  const needsSpaCoverage = stagedFiles.some((entry) =>
    /^react-spa\/src\/.*\.(ts|tsx)$/.test(entry)
  );

  return {
    needsApiCoverage,
    needsCoverageGate: needsApiCoverage || needsSpaCoverage,
    needsSpaCoverage,
  };
}

function detectPlaywrightWorkers(env: NodeJS.ProcessEnv): number {
  if (env.PLAYWRIGHT_WORKERS) {
    return Number.parseInt(env.PLAYWRIGHT_WORKERS, 10);
  }

  const cores = Number.parseInt(capture('getconf', ['_NPROCESSORS_ONLN']), 10) || 2;
  if (cores >= 8) return 4;
  if (cores >= 4) return 3;
  return 2;
}

function buildComposeProjectName(rootDir: string): string {
  const requested = process.env.COMPOSE_PROJECT_NAME?.trim();
  if (requested && requested !== DEFAULT_COMPOSE_PROJECT_NAME) {
    return requested;
  }

  const projectChecksum = createHash('sha1').update(rootDir).digest('hex').slice(0, 8);
  return `${DEFAULT_COMPOSE_PROJECT_NAME}_${projectChecksum}_${process.pid}`;
}

function hasPlaywrightBrowsers(playwrightCacheDir: string): boolean {
  return (
    existsSync(playwrightCacheDir) &&
    readdirSync(playwrightCacheDir).some((entry) => entry.startsWith('chromium-'))
  );
}

export async function buildVerifyPlan(env: NodeJS.ProcessEnv = process.env): Promise<VerifyPlan> {
  const testDbPort = env.TEST_DB_PORT
    ? Number.parseInt(env.TEST_DB_PORT, 10)
    : await pickTestDbPort();
  const stagedFiles = getStagedFiles('ACMR');
  const { submoduleOnly, skipOpenPathStatic } = detectSubmoduleOnly(getStagedFiles());
  const { needsApiCoverage, needsCoverageGate, needsSpaCoverage } =
    detectCoverageNeeds(stagedFiles);
  const playwrightCacheDir =
    env.PLAYWRIGHT_BROWSERS_PATH ?? join(env.HOME ?? '', '.cache/ms-playwright');

  return {
    browsersAvailable: hasPlaywrightBrowsers(playwrightCacheDir),
    composeFile: COMPOSE_FILE,
    composeProjectName: buildComposeProjectName(ROOT_DIR),
    mode: resolveVerifyMode(env),
    needsApiCoverage,
    needsCoverageGate,
    needsSpaCoverage,
    playwrightCacheDir,
    playwrightWorkers: detectPlaywrightWorkers(env),
    rootDir: ROOT_DIR,
    skipOpenPathStatic,
    submoduleOnly,
    testDbPort,
  };
}

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
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await run('docker', dockerComposeArgs(plan, args), { cwd: plan.rootDir, env });
}

async function waitForTestPostgres(plan: VerifyPlan): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const postgresReady = status(
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

function getVerifyEnv(plan: VerifyPlan): NodeJS.ProcessEnv {
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

export function validatePlaywrightReport(reportPath: string): void {
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

async function runPlaywrightVerification(plan: VerifyPlan, env: NodeJS.ProcessEnv): Promise<void> {
  const reportDir = mkdtempSync(join(tmpdir(), 'classroompath-playwright-report-'));
  const reportPath = join(reportDir, 'report.json');

  try {
    await run('npx', ['playwright', 'test'], {
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

async function cleanup(plan: VerifyPlan): Promise<void> {
  if (existsSync(plan.composeFile)) {
    await dockerCompose(plan, ['stop']).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const plan = await buildVerifyPlan();

  if (!status('docker', ['info'])) {
    throw new Error('Docker is not running (docker info failed). Start Docker and retry.');
  }

  const verifyEnv = getVerifyEnv(plan);

  console.log('');
  console.log('==========================================');
  console.log('  ClassroomPath Verification Starting');
  console.log(`  Mode: ${plan.mode}`);
  console.log('==========================================');
  console.log('');

  if (plan.submoduleOnly) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ⚡ OPTIMIZATION: Submodule-only update detected');
    console.log('  → Skipping OpenPath static checks (already verified in OpenPath repo)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  }

  if (!plan.needsCoverageGate) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ⚡ OPTIMIZATION: No ClassroomPath src changes detected');
    console.log('  → Running tests without coverage instrumentation');
    console.log('  → Coverage gate will be skipped');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  }

  try {
    console.log('[0/5] Checking test file coverage...');
    await run('bash', ['scripts/check-test-files.sh'], { cwd: ROOT_DIR, env: verifyEnv });
    await run('npm', ['run', 'verify:migrations:metadata'], { cwd: ROOT_DIR, env: verifyEnv });

    console.log('Starting PostgreSQL (test)...');
    await dockerCompose(plan, ['up', '-d', 'postgres'], verifyEnv);

    console.log('');
    console.log('[1/5] Building all packages...');
    await run('npm', ['run', 'build'], { cwd: plan.rootDir, env: verifyEnv });

    console.log('Waiting for PostgreSQL...');
    await waitForTestPostgres(plan);

    capture('node', [join(ROOT_DIR, 'scripts/derive-openpath-db-env.mjs')], {
      cwd: plan.rootDir,
      env: verifyEnv,
    })
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const match = line.match(/^export ([A-Z0-9_]+)=(.*)$/);
        if (match) {
          verifyEnv[match[1]] = JSON.parse(match[2]);
        }
      });

    console.log('');
    console.log('[2/5] Static analysis (parallel: typecheck, lint, format)...');
    if (plan.skipOpenPathStatic) {
      await runParallel([
        'npm run format:check',
        'npm run lint --workspace=@classroompath/react-spa',
      ]);
    } else {
      await runParallel([
        'cd upstream/openpath && npm run verify:static',
        'npm run format:check',
        'npm run lint --workspace=@classroompath/react-spa',
      ]);
    }

    console.log('');
    console.log('[3/5] Security and size checks (parallel)...');
    if (plan.skipOpenPathStatic) {
      await run('npm', ['audit', '--audit-level=high'], { cwd: plan.rootDir, env: verifyEnv });
    } else {
      await runParallel([
        'npm run security:audit',
        'npm run security:secrets',
        'npm run size:check',
      ]);
    }

    console.log('');
    console.log('[4/5] Running tests...');
    console.log('Running migrations...');
    await run(
      'npm',
      ['run', 'db:push', '--workspace=@classroompath/api', '--workspace=@openpath/api'],
      {
        cwd: plan.rootDir,
        env: verifyEnv,
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

    const spaPromise = runShell(spaCommand, { cwd: plan.rootDir, env: verifyEnv });
    await runShell(apiCommand, { cwd: plan.rootDir, env: verifyEnv });
    if (!plan.needsApiCoverage) {
      await runShell('npm run test:integration --workspace=@classroompath/api', {
        cwd: plan.rootDir,
        env: verifyEnv,
      });
    }
    await spaPromise;

    console.log('Running Playwright setup hard-failure tests...');
    await run(
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
        env: verifyEnv,
      }
    );

    console.log('');
    console.log('[4/5] Checking coverage on changed files (if any)...');
    if (plan.needsCoverageGate) {
      await run('node', ['scripts/check-new-file-coverage.js'], {
        cwd: plan.rootDir,
        env: verifyEnv,
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

    await run('docker', ['stop', 'openpath-api'], { cwd: plan.rootDir, env: verifyEnv }).catch(
      () => undefined
    );
    await runShell(
      'for port in 3001 3010 5173; do pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP \'pid=\\K\\d+\' | head -1 || true); if [ -n "$pid" ]; then echo "Killing orphaned process on port $port (PID: $pid)"; kill "$pid" 2>/dev/null || true; fi; done',
      { cwd: plan.rootDir, env: verifyEnv }
    );

    console.log(`Using Playwright workers: ${String(plan.playwrightWorkers)}`);
    console.log('Running full E2E Playwright suite...');
    await runPlaywrightVerification(plan, verifyEnv);

    console.log('');
    console.log('==========================================');
    console.log('  All Checks Passed!');
    console.log('==========================================');
    console.log('');
  } finally {
    await cleanup(plan);
  }
}

await main();
