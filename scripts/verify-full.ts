import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { createVerifyPlan, resolveVerifyMode } from './lib/verify-plan.ts';
import { createVerifyReporter } from './lib/verify-report.ts';
import {
  buildComposeProjectName,
  cleanupVerification,
  getVerifyEnv,
  hasPlaywrightBrowsers,
  pickTestDbPort,
  runFullVerification,
  runReleaseAutomationVerification,
  type RunOptions,
  type VerifyRuntime,
} from './lib/verify-stages.ts';

const ROOT_DIR = process.cwd();
const COMPOSE_FILE = join(ROOT_DIR, 'docker/docker-compose.test.yml');

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

async function runParallel(commands: string[], options: RunOptions = {}): Promise<void> {
  await Promise.all(commands.map((command) => runShell(command, options)));
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

function getStagedFiles(diffFilter?: string): string[] {
  const args = ['diff', '--cached', '--name-only'];
  if (diffFilter) {
    args.push(`--diff-filter=${diffFilter}`);
  }

  const output = capture('git', args);
  return output ? output.split('\n').filter(Boolean) : [];
}

function buildWorkspaceFingerprint(stagedFiles: string[]): string {
  const head = capture('git', ['rev-parse', 'HEAD']);
  const statusOutput = capture('git', ['status', '--short']);
  const submoduleStatus = capture('git', ['submodule', 'status', '--cached', 'upstream/openpath']);

  return createHash('sha256')
    .update(
      JSON.stringify({
        head,
        node: process.version,
        platform: process.platform,
        stagedFiles,
        statusOutput,
        submoduleStatus,
      })
    )
    .digest('hex');
}

export async function buildVerifyPlan(env: NodeJS.ProcessEnv = process.env) {
  const testDbPort = env.TEST_DB_PORT
    ? Number.parseInt(env.TEST_DB_PORT, 10)
    : await pickTestDbPort();
  const stagedFiles = getStagedFiles('ACMR');
  const playwrightCacheDir =
    env.PLAYWRIGHT_BROWSERS_PATH ?? join(env.HOME ?? '', '.cache/ms-playwright');

  return createVerifyPlan({
    browsersAvailable: hasPlaywrightBrowsers(playwrightCacheDir),
    composeFile: COMPOSE_FILE,
    composeProjectName: buildComposeProjectName(ROOT_DIR, env.COMPOSE_PROJECT_NAME, process.pid),
    mode: resolveVerifyMode(env),
    playwrightCacheDir,
    playwrightWorkers: detectPlaywrightWorkers(env),
    rootDir: ROOT_DIR,
    stagedFiles,
    testDbPort,
    workspaceFingerprint: buildWorkspaceFingerprint(stagedFiles),
  });
}

async function main(): Promise<void> {
  const plan = await buildVerifyPlan();
  const verifyEnv = getVerifyEnv(plan);
  const reporter = createVerifyReporter(plan);
  const runtime: VerifyRuntime = {
    capture,
    run,
    runParallel,
    runShell,
    status,
  };

  console.log('');
  console.log('==========================================');
  console.log('  ClassroomPath Verification Starting');
  console.log(`  Mode: ${plan.mode}`);
  console.log(`  Scope: ${plan.verificationScope}`);
  console.log(`  Report: ${reporter.getReportFile()}`);
  console.log('==========================================');
  console.log('');

  if (plan.submoduleOnly) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ⚡ OPTIMIZATION: Submodule-only update detected');
    console.log('  → Skipping OpenPath static checks (already verified in OpenPath repo)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    reporter.addNote('Submodule-only update detected; skipping OpenPath static verification.');
  }

  if (!plan.needsCoverageGate) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ⚡ OPTIMIZATION: No ClassroomPath src changes detected');
    console.log('  → Running tests without coverage instrumentation');
    console.log('  → Coverage gate will be skipped');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    reporter.addNote('No ClassroomPath API/SPA source changes detected; skipping coverage gate.');
  }

  if (plan.domainSummary.owners.length > 0) {
    reporter.addNote(`Owners: ${plan.domainSummary.owners.join(', ')}`);
  }

  if (plan.domainSummary.requiredApprovals.length > 0) {
    reporter.addNote(`Required approvals: ${plan.domainSummary.requiredApprovals.join(', ')}`);
  }

  try {
    if (plan.verificationScope === 'release-automation') {
      await runReleaseAutomationVerification(plan, verifyEnv, runtime, reporter);
    } else {
      if (!status('docker', ['info'])) {
        throw new Error('Docker is not running (docker info failed). Start Docker and retry.');
      }

      await runFullVerification(plan, verifyEnv, runtime, reporter);
    }

    reporter.finalize(true);
    console.log('');
    console.log('==========================================');
    console.log('  All Checks Passed!');
    console.log('==========================================');
    console.log('');
  } catch (error) {
    reporter.finalize(false);
    throw error;
  } finally {
    if (plan.verificationScope === 'full') {
      await cleanupVerification(plan, runtime);
    }
  }
}

await main();
