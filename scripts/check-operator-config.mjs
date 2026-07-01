#!/usr/bin/env node
// @ts-check

/**
 * One-pass check for the operator-private `.env.local` used by the local production-promotion
 * path: reports EVERY required operator var that is missing or still a placeholder, grouped by
 * stage, instead of failing one variable at a time across repeated deploy attempts.
 *
 * Covers the full set of operator vars read by:
 *   - `scripts/deploy-staging-local.sh` (STAGING_*)
 *   - `scripts/deploy-production-remote.sh`, `scripts/preflight-production-promotion-target.sh`,
 *     `scripts/verify-production-host-readiness.sh` (CLASSROOMPATH_DEPLOY_ROOT, DEPLOY_*)
 *   - `scripts/run-windows-ajax-direct.mjs`, `scripts/prepromotion-windows-evidence.mjs`,
 *     `scripts/lib/release-status-collector.mjs` (PROXMOX_*, WINDOWS_RUNNER_*)
 *
 * Invoked by: `npm run verify:operator-config` (`node scripts/check-operator-config.mjs`).
 * Usage: node scripts/check-operator-config.mjs
 * Exits with code 1 when any required var is missing/placeholder, 0 when complete.
 * Tested by `tests/check-operator-config.test.ts`.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution } from './lib/github-actions.mjs';
import { readEnvFileIfPresent } from './lib/env-local.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

// Placeholder values used across .env.local.example / config/*.example.json: hostnames ending in
// `.example` or `.example.invalid`, or any value ending in `.invalid`.
const PLACEHOLDER_VALUE_PATTERN = /(\.example(\.invalid)?$)|(\.invalid$)/i;

/**
 * Declared table of every operator var the promotion path reads. `required: false` entries are
 * documented for completeness but are not treated as gaps (they have working defaults/fallbacks
 * elsewhere in the scripts that read them).
 */
export const OPERATOR_CONFIG_VARS = [
  {
    name: 'CLASSROOMPATH_DEPLOY_ROOT',
    stage: 'production',
    required: true,
    purpose: 'Local root path for production deploy state (release-state, current-images.env).',
  },
  {
    name: 'STAGING_HOST',
    stage: 'staging',
    required: true,
    purpose: 'SSH hostname for the staging deploy target.',
  },
  {
    name: 'STAGING_USER',
    stage: 'staging',
    required: true,
    purpose: 'SSH user for the staging deploy target.',
  },
  {
    name: 'STAGING_SSH_KEY',
    stage: 'staging',
    required: true,
    purpose: 'Path to the SSH private key used to reach the staging host.',
  },
  {
    name: 'STAGING_PORT',
    stage: 'staging',
    required: false,
    purpose: 'SSH port for staging (default: 22).',
  },
  {
    name: 'STAGING_GHCR_USERNAME',
    stage: 'staging',
    required: false,
    purpose: 'GHCR username for pulling private release-candidate images onto staging.',
  },
  {
    name: 'STAGING_GHCR_TOKEN',
    stage: 'staging',
    required: false,
    purpose: 'GHCR token for pulling private release-candidate images onto staging.',
  },
  {
    name: 'DEPLOY_HOST',
    stage: 'production',
    required: false,
    purpose:
      'Production SSH hostname (auto-derived from config/deploy-targets.local.json when omitted).',
  },
  {
    name: 'DEPLOY_USER',
    stage: 'production',
    required: true,
    purpose: 'SSH user for the production deploy target.',
  },
  {
    name: 'DEPLOY_SSH_KEY',
    stage: 'production',
    required: false,
    purpose:
      'Path to the SSH private key for production (defaults to ~/.ssh/classroompath_deploy).',
  },
  {
    name: 'DEPLOY_PORT',
    stage: 'production',
    required: false,
    purpose: 'SSH port for production (default: 22).',
  },
  {
    name: 'PROXMOX_SSH_ALIAS',
    stage: 'windows-evidence',
    required: true,
    purpose: 'Proxmox SSH host/alias used for qm guest exec commands against the Windows runner.',
  },
  {
    name: 'PROXMOX_HOST',
    stage: 'windows-evidence',
    required: true,
    purpose: 'Proxmox host; preferred over PROXMOX_SSH_ALIAS when set, same qm guest exec path.',
  },
  {
    name: 'WINDOWS_RUNNER_VMID',
    stage: 'windows-evidence',
    required: true,
    purpose: 'VMID of the Windows runner VM on Proxmox for pre-promotion evidence collection.',
  },
  {
    name: 'WINDOWS_RUNNER_BASELINE_SNAPSHOT',
    stage: 'windows-evidence',
    required: false,
    purpose: 'Snapshot name to roll back the Windows runner to before a run (default: baseline).',
  },
  {
    name: 'CP_CLIENT_CANARY_ADMIN_TOKEN',
    stage: 'windows-evidence',
    required: false,
    purpose: 'Admin token for the post-production Windows canary; skipped gracefully if absent.',
  },
];

function isMissing(value) {
  return typeof value !== 'string' || value.trim().length === 0;
}

function isPlaceholder(value) {
  return PLACEHOLDER_VALUE_PATTERN.test(value.trim());
}

/**
 * Pure check: given an env-like object, returns every required operator var that is missing or
 * still a placeholder value. Does not read files or process.env itself, so it is fully unit
 * testable without touching the real `.env.local`.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Array<{ name: string, stage: string, reason: 'missing' | 'placeholder' }>}
 */
export function evaluateOperatorConfig(env) {
  const gaps = [];
  for (const entry of OPERATOR_CONFIG_VARS) {
    if (!entry.required) {
      continue;
    }
    const raw = env[entry.name];
    if (isMissing(raw)) {
      gaps.push({ name: entry.name, stage: entry.stage, reason: 'missing' });
      continue;
    }
    if (isPlaceholder(/** @type {string} */ (raw))) {
      gaps.push({ name: entry.name, stage: entry.stage, reason: 'placeholder' });
    }
  }
  return gaps;
}

function groupByStage(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.stage)) {
      groups.set(item.stage, []);
    }
    groups.get(item.stage).push(item);
  }
  return groups;
}

function render(gaps) {
  const requiredCount = OPERATOR_CONFIG_VARS.filter((entry) => entry.required).length;
  if (gaps.length === 0) {
    return `Operator config check: COMPLETE (${requiredCount}/${requiredCount} required vars set in .env.local)\n`;
  }

  const lines = [
    `Operator config check: ${gaps.length} of ${requiredCount} required vars missing or placeholder in .env.local`,
    '',
  ];
  const groups = groupByStage(gaps);
  for (const [stage, items] of groups) {
    lines.push(`stage: ${stage}`);
    for (const item of items) {
      lines.push(`  - ${item.name}: ${item.reason}`);
    }
    lines.push('');
  }
  lines.push('Fix .env.local, then re-run: npm run verify:operator-config');
  return `${lines.join('\n')}\n`;
}

function main() {
  const mergedEnv = readEnvFileIfPresent(process.env, resolve(projectRoot, '.env.local'));
  const gaps = evaluateOperatorConfig(mergedEnv);
  process.stdout.write(render(gaps));
  if (gaps.length > 0) {
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  main();
}
