import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readReleaseStateSnapshot } from './release-state-contract.mjs';
import { evaluateReleaseRiskPaths } from './release-risk-policy.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitMaybe(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

export function resolveReleaseRiskTargetSha(env = process.env, cwd = process.cwd()) {
  if (env.TARGET_SHA) {
    return env.TARGET_SHA;
  }

  if (env.GITHUB_SHA) {
    return env.GITHUB_SHA;
  }

  return git(['rev-parse', 'HEAD'], cwd);
}

export function resolveReleaseRiskBaseRef(env = process.env, cwd = process.cwd()) {
  const productionStatePath = resolve(
    cwd,
    env.PRODUCTION_RELEASE_STATE_PATH || './production-release-state.env'
  );

  if (env.PRODUCTION_CURRENT_APP_SHA) {
    return { baseRef: env.PRODUCTION_CURRENT_APP_SHA, baseSource: 'production-state' };
  }

  if (existsSync(productionStatePath)) {
    const productionState = readReleaseStateSnapshot(productionStatePath);
    if (productionState.APP_SHA) {
      return { baseRef: productionState.APP_SHA, baseSource: 'production-state' };
    }
  }

  gitMaybe(['fetch', '--tags', '--force'], cwd);
  const currentRefName = env.GITHUB_REF_NAME || '';
  const previousTag = gitMaybe(['tag', '--sort=-creatordate'], cwd)
    .split('\n')
    .filter(Boolean)
    .find((tag) => tag.startsWith('v') && tag !== currentRefName);

  if (previousTag) {
    return { baseRef: previousTag, baseSource: 'previous-tag' };
  }

  return { baseRef: '', baseSource: 'target-only' };
}

export function listReleaseRiskChangedFiles(baseRef, targetRef, cwd = process.cwd()) {
  const output = baseRef
    ? git(['diff', '--name-only', `${baseRef}...${targetRef}`], cwd)
    : git(['show', '--pretty=', '--name-only', targetRef], cwd);

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function evaluateReleaseRisk(changedFiles) {
  return evaluateReleaseRiskPaths(changedFiles);
}

export function emitReleaseRiskOutputs(outputPath, result) {
  if (!outputPath) {
    return;
  }

  const lines = [
    `high_risk=${result.highRisk ? 'true' : 'false'}`,
    `base_ref=${result.baseRef ?? ''}`,
    `base_source=${result.baseSource ?? 'unknown'}`,
  ];

  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf-8');
}
