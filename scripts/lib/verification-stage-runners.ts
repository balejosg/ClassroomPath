import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createVerifyCache, type VerifyStageArtifact } from './verify-cache.ts';
import {
  buildComposeProjectName,
  cleanupStaleVerificationProjects,
  cleanupVerification,
  getVerifyEnv,
  pickTestDbPort,
  waitForTestPostgres,
} from './verify-docker.ts';
import { hasPlaywrightBrowsers, runPlaywrightVerification } from './verify-playwright.ts';
import type { VerifyPlan } from './verify-plan.ts';
import type { VerifyReporter } from './verify-report.ts';
import { runReportedStage, type VerifyRuntime } from './verify-runtime.ts';
import { ensureOpenPathWorkspaceInstall } from './verify-test-runners.ts';
import {
  getVerificationPipelineDefinition,
  getVerificationStageDefinition,
} from './verification-catalog.mjs';

export type { RunOptions, VerifyRuntime } from './verify-runtime.ts';
export {
  buildComposeProjectName,
  cleanupStaleVerificationProjects,
  cleanupVerification,
  getVerifyEnv,
  pickTestDbPort,
} from './verify-docker.ts';
export { hasPlaywrightBrowsers } from './verify-playwright.ts';

export function resolvePlaywrightVerificationCommand(plan: VerifyPlan): string | null {
  if (plan.e2eDepth === 'skip') return null;
  if (plan.e2eDepth === 'commit-smoke') return 'npm run test:e2e:commit-smoke';
  return 'npm run test:e2e:full';
}

type VerificationStageExecution = {
  artifacts?: VerifyStageArtifact[];
  cacheValue?: unknown;
  details?: Record<string, unknown>;
  run: () => Promise<void>;
  skipReason?: string;
  validate?: () => boolean;
};

type VerificationPipelineContext = {
  env: NodeJS.ProcessEnv;
  plan: VerifyPlan;
  reporter: VerifyReporter;
  runtime: VerifyRuntime;
};

type VerificationStageDefinition = {
  after?: string[];
  before?: string[];
  heading?: string;
  id: string;
  label: string;
  progressLabel?: string;
  runner: string;
};

function createStageCache(
  plan: VerifyPlan,
  stageId: string,
  value: unknown,
  validate?: () => boolean,
  artifacts?: VerifyStageArtifact[]
) {
  if (!isStageCacheEnabled(plan, stageId)) {
    return undefined;
  }

  const cache = createVerifyCache(plan);
  return {
    clearStage: cache.clearStage,
    artifacts,
    key: cache.buildStageCacheKey(stageId, value),
    rememberPassedStage: cache.rememberPassedStage,
    shouldReuse: cache.shouldReuse,
    validate,
  };
}

export function isStageCacheEnabled(plan: VerifyPlan, stageId: string): boolean {
  if (plan.mode === 'release') {
    return false;
  }

  const definition = getVerificationStageDefinition(plan.verificationScope, stageId);
  return definition?.cache === 'diff-safe';
}

function printPipelineBanner(banner?: { lines?: string[] }) {
  const lines = banner?.lines ?? [];
  if (lines.length === 0) {
    return;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

async function runPipelineHook(hookId: string, context: VerificationPipelineContext) {
  const { env, plan, runtime } = context;

  switch (hookId) {
    case 'cleanup-stale-verification-projects':
      await cleanupStaleVerificationProjects(plan, runtime);
      return;
    case 'cleanup-verification':
      await cleanupVerification(plan, runtime);
      return;
    case 'start-test-postgres':
      console.log('Starting PostgreSQL (test)...');
      await runtime.run(
        'docker',
        ['compose', '-p', plan.composeProjectName, '-f', plan.composeFile, 'up', '-d', 'postgres'],
        { cwd: plan.rootDir, env }
      );
      return;
    case 'wait-for-postgres-and-derive-db-env': {
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
      return;
    }
    case 'stop-openpath-api':
      await runtime
        .run('docker', ['stop', 'openpath-api'], { cwd: plan.rootDir, env })
        .catch(() => undefined);
      return;
    case 'kill-orphaned-dev-ports':
      await runtime.runShell(
        'for port in 3001 3010 5173; do pid=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP \'pid=\\K\\d+\' | head -1 || true); if [ -n "$pid" ]; then echo "Killing orphaned process on port $port (PID: $pid)"; kill "$pid" 2>/dev/null || true; fi; done',
        { cwd: plan.rootDir, env }
      );
      return;
    default:
      throw new Error(`Unknown verification pipeline hook: ${hookId}`);
  }
}

function createStageExecution(
  stage: VerificationStageDefinition,
  context: VerificationPipelineContext
): VerificationStageExecution {
  const { env, plan, runtime } = context;

  switch (stage.runner) {
    case 'format-and-secrets':
      return {
        cacheValue: {
          commands: ['npm run format:check', 'npm run security:secrets', 'npm run verify:docs'],
        },
        details: {
          commands: ['npm run format:check', 'npm run security:secrets', 'npm run verify:docs'],
        },
        run: async () => {
          await runtime.runParallel(
            ['npm run format:check', 'npm run security:secrets', 'npm run verify:docs'],
            {
              cwd: plan.rootDir,
              env,
            }
          );
        },
      };
    case 'ops-regression':
      return {
        cacheValue: { command: 'npm run test:ci-regression' },
        details: { command: 'npm run test:ci-regression' },
        run: async () => {
          await runtime.run('npm', ['run', 'test:ci-regression'], {
            cwd: plan.rootDir,
            env,
          });
        },
      };
    case 'release-automation-regression':
      return {
        cacheValue: { command: 'npm run test:release-automation' },
        details: { command: 'npm run test:release-automation' },
        run: async () => {
          await runtime.run('npm', ['run', 'test:release-automation'], {
            cwd: plan.rootDir,
            env,
          });
        },
      };
    case 'test-file-coverage':
      return {
        cacheValue: {
          command: 'bash scripts/check-test-files.sh && npm run verify:migrations:metadata',
        },
        details: { command: 'bash scripts/check-test-files.sh' },
        run: async () => {
          await runtime.run('bash', ['scripts/check-test-files.sh'], { cwd: plan.rootDir, env });
          await runtime.run('npm', ['run', 'verify:migrations:metadata'], {
            cwd: plan.rootDir,
            env,
          });
        },
      };
    case 'build':
      return {
        artifacts: [
          { kind: 'build-output', path: join(plan.rootDir, 'api/dist') },
          { kind: 'build-output', path: join(plan.rootDir, 'react-spa/dist') },
          { kind: 'build-output', path: join(plan.rootDir, 'upstream/openpath/api/dist') },
        ],
        cacheValue: { command: 'npm run build' },
        details: { command: 'npm run build' },
        run: async () => {
          await ensureOpenPathWorkspaceInstall(plan.rootDir, env, runtime);
          await runtime.run('npm', ['run', 'build'], { cwd: plan.rootDir, env });
        },
        validate: () =>
          existsSync(join(plan.rootDir, 'api/dist')) &&
          existsSync(join(plan.rootDir, 'react-spa/dist')) &&
          existsSync(join(plan.rootDir, 'upstream/openpath/api/dist')),
      };
    case 'static-analysis':
      return {
        cacheValue: {
          command:
            'bash scripts/run-turbo.sh verify:static && npm run format:check && npm run verify:docs',
          skipOpenPathStatic: plan.skipOpenPathStatic,
        },
        details: {
          command:
            'bash scripts/run-turbo.sh verify:static && npm run format:check && npm run verify:docs',
          skipOpenPathStatic: plan.skipOpenPathStatic,
        },
        run: async () => {
          await runtime.run('bash', ['scripts/run-turbo.sh', 'verify:static'], {
            cwd: plan.rootDir,
            env,
          });
          if (!plan.skipOpenPathStatic) {
            await runtime.run('bash', ['scripts/run-openpath.sh', 'npm', 'run', 'verify:static'], {
              cwd: plan.rootDir,
              env,
            });
          }
          await runtime.run('npm', ['run', 'format:check'], { cwd: plan.rootDir, env });
          await runtime.run('npm', ['run', 'verify:docs'], { cwd: plan.rootDir, env });
        },
      };
    case 'security-and-size':
      return {
        cacheValue: {
          skipOpenPathStatic: plan.skipOpenPathStatic,
        },
        details: { skipOpenPathStatic: plan.skipOpenPathStatic },
        run: async () => {
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
        },
      };
    case 'tests':
      return {
        details: {
          apiCoverage: plan.needsApiCoverage,
          spaCoverage: plan.needsSpaCoverage,
        },
        run: async () => {
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
        },
      };
    case 'coverage-gate':
      return {
        cacheValue: { command: 'node scripts/check-new-file-coverage.js' },
        details: { command: 'node scripts/check-new-file-coverage.js' },
        run: async () => {
          await runtime.run('node', ['scripts/check-new-file-coverage.js'], {
            cwd: plan.rootDir,
            env,
          });
        },
        skipReason: plan.needsCoverageGate ? undefined : 'no changed API/SPA source files',
      };
    case 'playwright-e2e':
      return {
        details: { workers: plan.playwrightWorkers },
        skipReason: plan.e2eDepth === 'skip' ? 'fast verification skips Playwright E2E' : undefined,
        run: async () => {
          const command = resolvePlaywrightVerificationCommand(plan);
          if (!command) {
            return;
          }

          if (!plan.browsersAvailable) {
            throw new Error(
              `Playwright browsers are required for local verification and are not installed. Cache: ${plan.playwrightCacheDir}`
            );
          }

          console.log(`Using Playwright workers: ${String(plan.playwrightWorkers)}`);
          if (plan.e2eDepth === 'commit-smoke') {
            console.log('Running commit-smoke Playwright suite...');
            await runtime.runShell(command, { cwd: plan.rootDir, env });
            return;
          }

          console.log('Running full E2E Playwright suite...');
          await runPlaywrightVerification(plan, env, runtime);
        },
      };
    default:
      throw new Error(`Unknown verification stage runner: ${stage.runner}`);
  }
}

export function listVerificationStageRunnerIds() {
  return [
    'format-and-secrets',
    'ops-regression',
    'release-automation-regression',
    'test-file-coverage',
    'build',
    'static-analysis',
    'security-and-size',
    'tests',
    'coverage-gate',
    'playwright-e2e',
  ];
}

export async function runVerificationPipeline(
  scope: VerifyPlan['verificationScope'],
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime,
  reporter: VerifyReporter
): Promise<void> {
  const pipeline = getVerificationPipelineDefinition(scope);
  if (!pipeline) {
    throw new Error(`Unknown verification pipeline scope: ${scope}`);
  }

  const context: VerificationPipelineContext = { env, plan, reporter, runtime };
  printPipelineBanner(pipeline.banner);

  for (const hookId of pipeline.beforeAll ?? []) {
    await runPipelineHook(hookId, context);
  }

  for (const stage of pipeline.stages as VerificationStageDefinition[]) {
    const progress = stage.progressLabel ? `[${stage.progressLabel}] ` : '';
    if (stage.heading) {
      console.log(`${progress}${stage.heading}`);
    }

    for (const hookId of stage.before ?? []) {
      await runPipelineHook(hookId, context);
    }

    const execution = createStageExecution(stage, context);
    if (execution.skipReason) {
      if (stage.id === 'coverage-gate') {
        console.log('Skipping coverage gate (no changed API/SPA source files).');
      }
      reporter.skipStage(stage.id, stage.label, { reason: execution.skipReason });
      console.log('');
      continue;
    }

    await runReportedStage(
      reporter,
      {
        id: stage.id,
        label: stage.label,
        cache: createStageCache(
          plan,
          stage.id,
          execution.cacheValue ?? null,
          execution.validate,
          execution.artifacts
        ),
        details: execution.details,
      },
      execution.run
    );

    for (const hookId of stage.after ?? []) {
      await runPipelineHook(hookId, context);
    }

    console.log('');
  }
}
