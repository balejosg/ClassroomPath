/**
 * Safe wrappers around git subprocess calls: sanitizeGitEnv, gitOutput, and gitMaybe helpers.
 *
 * Invoked by: Imported by scripts that need git metadata (diff base, submodule SHA).
 * Usage: (library module, not invoked directly)
 */
import { execFileSync } from 'node:child_process';

export const SANITIZED_GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
];

export function sanitizeGitEnv(env = process.env) {
  const sanitized = { ...env };

  for (const key of SANITIZED_GIT_ENV_KEYS) {
    delete sanitized[key];
  }

  return sanitized;
}

export function gitOutput(args, options = {}) {
  const { cwd, env = process.env } = options;

  return execFileSync('git', args, {
    cwd,
    env: sanitizeGitEnv(env),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function gitMaybe(args, options = {}) {
  try {
    return gitOutput(args, options);
  } catch {
    return '';
  }
}
