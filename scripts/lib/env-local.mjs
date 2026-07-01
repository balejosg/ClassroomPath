// @ts-check

/**
 * Shared `.env.local` merge helper: fills in env vars that are present on disk but not
 * already set on the provided `env` object, without overwriting any key that's already set.
 *
 * Invoked by: `release-status-collector.mjs` (release:status) and `release-preflight.mjs`
 * (release:preflight), so both read the same local operator overrides (STAGING_HOST,
 * DEPLOY_HOST, PROXMOX_HOST, etc.) from `.env.local` when it exists.
 * Usage: (library module, not invoked directly)
 * Tested indirectly by `tests/release-status.test.ts` and `tests/release-preflight.test.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';

export function readEnvFileIfPresent(env, filePath) {
  if (!existsSync(filePath)) {
    return env;
  }

  const merged = { ...env };
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key || key in merged) {
      continue;
    }

    merged[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return merged;
}
