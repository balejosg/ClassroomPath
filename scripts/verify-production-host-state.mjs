// @ts-check
/**
 * Read-only verification of the REAL production host release state.
 *
 * A green GitHub run is not proof that a release is live: a partial rerun can turn
 * green after rollback-production already reverted the host. The only authority is
 * the host's release-state directory.
 *
 * Invoked by: release-promote.mjs step `verify-production-host-state`.
 * Usage: node scripts/verify-production-host-state.mjs --tag vX.Y.Z [--app-sha SHA] [--openpath-sha SHA]
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assertDeployTargetReady, getDeployTarget } from './deploy-targets.mjs';
import { parseRuntimeEnvironmentText } from './lib/deployed-release-state.mjs';
import { readEnvFileIfPresent } from './lib/env-local.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pure comparison of host state files against the expected release identity.
 *
 * @param {{ currentImagesText: string, deploymentPhaseText: string, expected: { appSha: string, openpathSha: string } }} input
 * @returns {{ ok: boolean, failures: string[], observed: Record<string, string> }}
 */
export function evaluateProductionHostState({ currentImagesText, deploymentPhaseText, expected }) {
  const failures = [];
  const current = parseRuntimeEnvironmentText(currentImagesText);
  const phase = parseRuntimeEnvironmentText(deploymentPhaseText);
  const observed = {
    APP_SHA: String(current.APP_SHA ?? ''),
    OPENPATH_SHA: String(current.OPENPATH_SHA ?? ''),
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: String(
      current.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT ?? ''
    ),
    DEPLOYMENT_PHASE: String(phase.DEPLOYMENT_PHASE ?? ''),
    ROLLBACK_ATTEMPTED: String(phase.ROLLBACK_ATTEMPTED ?? ''),
  };
  const expectEqual = (key, want) => {
    if (observed[key] !== want) {
      failures.push(`${key}=${observed[key] || '<missing>'} (expected ${want})`);
    }
  };
  expectEqual('APP_SHA', expected.appSha);
  expectEqual('OPENPATH_SHA', expected.openpathSha);
  expectEqual('OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT', expected.openpathSha);
  expectEqual('DEPLOYMENT_PHASE', 'COMMITTED');
  expectEqual('ROLLBACK_ATTEMPTED', '0');
  return { ok: failures.length === 0, failures, observed };
}

/**
 * @param {{ deployRoot: string, readRemoteFile: (path: string) => Promise<string>, expected: { appSha: string, openpathSha: string } }} input
 */
export async function verifyProductionHostState({ deployRoot, readRemoteFile, expected }) {
  const stateDir = `${String(deployRoot).replace(/\/+$/, '')}/release-state`;
  const currentImagesText = await readRemoteFile(`${stateDir}/current-images.env`);
  const deploymentPhaseText = await readRemoteFile(`${stateDir}/deployment-phase.env`);
  return evaluateProductionHostState({ currentImagesText, deploymentPhaseText, expected });
}

/** Build a read-only SSH reader from the existing deploy config conventions. */
export function createSshRemoteFileReader({ env, run = execFileAsync }) {
  const target = getDeployTarget('production');
  assertDeployTargetReady('production', target, ['publicUrl']);
  const host =
    env.DEPLOY_HOST ||
    String(target.publicUrl ?? '')
      .replace(/^https?:\/\//, '')
      .split('/')[0];
  const user = env.DEPLOY_USER;
  const keyPath = (env.DEPLOY_SSH_KEY || join(homedir(), '.ssh', 'classroompath_deploy')).replace(
    /^~(?=\/)/,
    homedir()
  );
  if (!host || !user) {
    throw new Error('DEPLOY_HOST (or production publicUrl) and DEPLOY_USER must be configured');
  }
  if (!existsSync(keyPath)) {
    throw new Error('Production SSH key not found (set DEPLOY_SSH_KEY)');
  }
  return async (remotePath) => {
    const { stdout } = await run('ssh', [
      '-F',
      env.DEPLOY_SSH_CONFIG || '/dev/null',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      `StrictHostKeyChecking=${env.DEPLOY_SSH_STRICT_HOSTKEY || 'accept-new'}`,
      '-i',
      keyPath,
      '-p',
      String(env.DEPLOY_PORT || '22'),
      `${user}@${host}`,
      `cat ${JSON.stringify(remotePath)}`,
    ]);
    return String(stdout);
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

async function git(...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: projectRoot });
  return String(stdout).trim();
}

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseArgs(argv);
  if (!args.tag) {
    throw new Error('Usage: verify-production-host-state.mjs --tag <vX.Y.Z>');
  }
  const mergedEnv = readEnvFileIfPresent({ ...env }, join(projectRoot, '.env.local'));
  const appSha = args['app-sha'] || (await git('rev-list', '-n', '1', args.tag));
  const openpathSha =
    args['openpath-sha'] || (await git('rev-parse', `${appSha}:upstream/openpath`));
  const deployRoot = mergedEnv.CLASSROOMPATH_DEPLOY_ROOT;
  if (!deployRoot) {
    throw new Error('CLASSROOMPATH_DEPLOY_ROOT must be set to the private production deploy root');
  }
  const readRemoteFile = deps.readRemoteFile ?? createSshRemoteFileReader({ env: mergedEnv });
  const result = await verifyProductionHostState({
    deployRoot,
    readRemoteFile,
    expected: { appSha, openpathSha },
  });
  if (!result.ok) {
    throw new Error(
      `Production host state does not match ${args.tag} (production may have been rolled back): ${result.failures.join(
        '; '
      )}`
    );
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (result) => {
      process.stdout.write(`Production host state verified: ${JSON.stringify(result.observed)}\n`);
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
  );
}
