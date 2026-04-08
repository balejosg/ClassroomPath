import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { VerifyRuntime } from './verify-runtime.ts';

export function needsOpenPathWorkspaceInstall(openPathRootDir: string): boolean {
  const installMarkerPath = join(openPathRootDir, 'node_modules/.package-lock.json');
  const lockfilePath = join(openPathRootDir, 'package-lock.json');

  if (!existsSync(lockfilePath)) {
    throw new Error(`OpenPath package-lock.json not found at ${lockfilePath}`);
  }

  if (!existsSync(installMarkerPath)) {
    return true;
  }

  return statSync(installMarkerPath).mtimeMs < statSync(lockfilePath).mtimeMs;
}

export async function ensureOpenPathWorkspaceInstall(
  rootDir: string,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  const openPathRootDir = resolve(rootDir, 'upstream/openpath');

  if (!needsOpenPathWorkspaceInstall(openPathRootDir)) {
    return;
  }

  console.log('Bootstrapping OpenPath workspace dependencies...');
  await runtime.run('npm', ['ci'], { cwd: openPathRootDir, env });
}
