import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildComposeProjectName,
  cleanupStaleVerificationProjects,
  cleanupVerification,
  getVerifyEnv,
  pickTestDbPort,
  waitForTestPostgres,
} from './verify-docker.ts';
import type { VerifyPlan } from './verify-plan.ts';
import type { VerifyReporter } from './verify-report.ts';
import { createVerifyCache } from './verify-cache.ts';
import { hasPlaywrightBrowsers, runPlaywrightVerification } from './verify-playwright.ts';
import { runReportedStage, type VerifyRuntime } from './verify-runtime.ts';
import { getVerificationStageDefinition } from './verification-catalog.mjs';
import { ensureOpenPathWorkspaceInstall } from './verify-test-runners.ts';

export type { RunOptions, VerifyRuntime } from './verify-runtime.ts';
export {
  buildComposeProjectName,
  cleanupStaleVerificationProjects,
  cleanupVerification,
  getVerifyEnv,
  pickTestDbPort,
} from './verify-docker.ts';
export { hasPlaywrightBrowsers } from './verify-playwright.ts';

function createStageCache(
  plan: VerifyPlan,
  stageId: string,
  value: unknown,
  validate?: () => boolean
) {
  const definition = getVerificationStageDefinition(plan.verificationScope, stageId);
  if (!definition || definition.cache !== 'diff-safe') {
    return undefined;
  }

  const cache = createVerifyCache(plan);
  return {
    clearStage: cache.clearStage,
    key: cache.buildStageCacheKey(stageId, value),
    rememberPassedStage: cache.rememberPassedStage,
    shouldReuse: cache.shouldReuse,
    validate,
  };
}

export async function runReleaseAutomationVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime,
  reporter: VerifyReporter
): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ⚡ OPTIMIZATION: Release automation-only diff detected');
  console.log(
    '  → Running targeted workflow/release regression instead of full product verification'
  );
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  console.log('[1/2] Format and secret checks...');
  await runReportedStage(
    reporter,
    {
      id: 'format-and-secrets',
      label: 'Format and secret checks',
      cache: createStageCache(plan, 'format-and-secrets', {
        commands: ['npm run format:check', 'npm run security:secrets'],
      }),
      details: { commands: ['npm run format:check', 'npm run security:secrets'] },
    },
    async () => {
      await runtime.runParallel(['npm run format:check', 'npm run security:secrets'], {
        cwd: plan.rootDir,
        env,
      });
    }
  );

  console.log('');
  console.log('[2/2] Release automation regression...');
  await runReportedStage(
    reporter,
    {
      id: 'release-automation-regression',
      label: 'Release automation regression',
      cache: createStageCache(plan, 'release-automation-regression', {
        command: 'npm run test:release-automation',
      }),
      details: { command: 'npm run test:release-automation' },
    },
    async () => {
      await runtime.run('npm', ['run', 'test:release-automation'], {
        cwd: plan.rootDir,
        env,
      });
    }
  );
}

export async function runFullVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime,
  reporter: VerifyReporter
): Promise<void> {
  await cleanupStaleVerificationProjects(plan, runtime);
  await cleanupVerification(plan, runtime);

  console.log('[0/5] Checking test file coverage...');
  await runReportedStage(
    reporter,
    {
      id: 'test-file-coverage',
      label: 'Test file coverage inventory',
      cache: createStageCache(plan, 'test-file-coverage', {
        command: 'bash scripts/check-test-files.sh && npm run verify:migrations:metadata',
      }),
      details: { command: 'bash scripts/check-test-files.sh' },
    },
    async () => {
      await runtime.run('bash', ['scripts/check-test-files.sh'], { cwd: plan.rootDir, env });
      await runtime.run('npm', ['run', 'verify:migrations:metadata'], { cwd: plan.rootDir, env });
    }
  );

  console.log('Starting PostgreSQL (test)...');
  await runtime.run(
    'docker',
    ['compose', '-p', plan.composeProjectName, '-f', plan.composeFile, 'up', '-d', 'postgres'],
    { cwd: plan.rootDir, env }
  );

  console.log('');
  console.log('[1/5] Building all packages...');
  await runReportedStage(
    reporter,
    {
      id: 'build',
      label: 'Build all packages',
      cache: createStageCache(
        plan,
        'build',
        { command: 'npm run build' },
        () =>
          existsSync(join(plan.rootDir, 'api/dist')) &&
          existsSync(join(plan.rootDir, 'react-spa/dist')) &&
          existsSync(join(plan.rootDir, 'upstream/openpath/api/dist'))
      ),
      details: { command: 'npm run build' },
    },
    async () => {
      await ensureOpenPathWorkspaceInstall(plan.rootDir, env, runtime);
      await runtime.run('npm', ['run', 'build'], { cwd: plan.rootDir, env });
    }
  );

  console.log('Waiting for PostgreSQL...');
  await waitForTestPostgres(plan, runtime);

  const derivedDbEnv = runtime
    .capture('node', [join(plan.rootDir, 'scripts/derive-openpath-db-env.mjs')], {
      cwd: plan.rootDir,
      env,
    })
    .split('\n')
    .filter(Boolean);

  for (const line of derivedDbEnv) {
    const match = line.match(/^export ([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    env[match[1]] = JSON.parse(match[2]);
  }

  console.log('');
  console.log('[2/5] Static analysis (parallel: typecheck, lint, format)...');
  await runReportedStage(
    reporter,
    {
      id: 'static-analysis',
      label: 'Static analysis',
      cache: createStageCache(plan, 'static-analysis', {
        command: 'bash scripts/run-turbo.sh verify:static && npm run format:check',
        skipOpenPathStatic: plan.skipOpenPathStatic,
      }),
      details: {
        command: 'bash scripts/run-turbo.sh verify:static && npm run format:check',
        skipOpenPathStatic: plan.skipOpenPathStatic,
      },
    },
    async () => {
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
    }
  );

  console.log('');
  console.log('[3/5] Security and size checks (parallel)...');
  await runReportedStage(
    reporter,
    {
      id: 'security-and-size',
      label: 'Security and size checks',
      cache: createStageCache(plan, 'security-and-size', {
        skipOpenPathStatic: plan.skipOpenPathStatic,
      }),
      details: { skipOpenPathStatic: plan.skipOpenPathStatic },
    },
    async () => {
      if (plan.skipOpenPathStatic) {
        await runtime.run('npm', ['audit', '--audit-level=high'], { cwd: plan.rootDir, env });
        return;
      }

      await runtime.runParallel(
        ['npm run security:audit', 'npm run security:secrets', 'npm run size:check'],
        {
          cwd: plan.rootDir,
          env,
        }
      );
    }
  );

  console.log('');
  console.log('[4/5] Running tests...');
  console.log('Running migrations...');
  await runReportedStage(
    reporter,
    {
      id: 'tests',
      label: 'Unit and integration tests',
      details: {
        apiCoverage: plan.needsApiCoverage,
        spaCoverage: plan.needsSpaCoverage,
      },
    },
    async () => {
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
    }
  );

  console.log('');
  console.log('[4/5] Checking coverage on changed files (if any)...');
  if (plan.needsCoverageGate) {
    await runReportedStage(
      reporter,
      {
        id: 'coverage-gate',
        label: 'Changed-file coverage gate',
        cache: createStageCache(plan, 'coverage-gate', {
          command: 'node scripts/check-new-file-coverage.js',
        }),
        details: { command: 'node scripts/check-new-file-coverage.js' },
      },
      async () => {
        await runtime.run('node', ['scripts/check-new-file-coverage.js'], {
          cwd: plan.rootDir,
          env,
        });
      }
    );
  } else {
    console.log('Skipping coverage gate (no changed API/SPA source files).');
    reporter.skipStage('coverage-gate', 'Changed-file coverage gate', {
      reason: 'no changed API/SPA source files',
    });
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
  await runReportedStage(
    reporter,
    {
      id: 'playwright-e2e',
      label: 'Playwright E2E',
      details: { workers: plan.playwrightWorkers },
    },
    async () => {
      await runPlaywrightVerification(plan, env, runtime);
    }
  );
}
