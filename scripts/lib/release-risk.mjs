import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { gitMaybe as defaultGitMaybe, gitOutput as defaultGitOutput } from './git-process.mjs';
import { listChangedFilesMergeBaseSafe } from './git-history-preflight.mjs';
import { readReleaseStateSnapshot } from './release-state-contract.mjs';
import {
  evaluateReleaseRiskPaths,
  evaluateReleaseRiskPathsForCanary,
} from './release-risk-policy.mjs';

export function resolveReleaseRiskTargetSha(env = process.env, cwd = process.cwd()) {
  if (env.TARGET_SHA) {
    return env.TARGET_SHA;
  }

  if (env.GITHUB_SHA) {
    return env.GITHUB_SHA;
  }

  return defaultGitOutput(['rev-parse', 'HEAD'], { cwd, env });
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

  defaultGitMaybe(['fetch', '--tags', '--force'], { cwd, env });
  const currentRefName = env.GITHUB_REF_NAME || '';
  const previousTag = defaultGitMaybe(['tag', '--sort=-creatordate'], { cwd, env })
    .split('\n')
    .filter(Boolean)
    .find((tag) => tag.startsWith('v') && tag !== currentRefName);

  if (previousTag) {
    return { baseRef: previousTag, baseSource: 'previous-tag' };
  }

  return { baseRef: '', baseSource: 'target-only' };
}

export function listReleaseRiskChangedFiles(baseRef, targetRef, cwd = process.cwd(), options = {}) {
  const gitOutput = options.gitOutput ?? defaultGitOutput;
  const gitMaybe = options.gitMaybe ?? defaultGitMaybe;
  const env = options.env ?? process.env;
  const output = listChangedFilesMergeBaseSafe({
    gitOutput,
    gitMaybe,
    baseRef,
    targetRef,
    cwd,
    env,
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function evaluateReleaseRisk(changedFiles, options = {}) {
  if (options.canary) {
    return evaluateReleaseRiskPathsForCanary(changedFiles, options.canary);
  }

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
