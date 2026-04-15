import * as childProcess from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildFreshnessCheck {
  distEntry: string;
  roots: string[];
}

export interface BuildTarget extends BuildFreshnessCheck {
  buildCommand: string;
  id: 'gateway' | 'openpath-api';
  projectRoot: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules']);

export const buildCommandRunner = {
  execSync(command: string, options: childProcess.ExecSyncOptions): Buffer {
    return childProcess.execSync(command, options);
  },
};

function collectLatestMtimeMs(targetPath: string): number {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);
  if (stats.isFile()) {
    return stats.mtimeMs;
  }

  let latest = 0;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    latest = Math.max(latest, collectLatestMtimeMs(resolve(targetPath, entry.name)));
  }

  return latest;
}

export function isBuildStale(check: BuildFreshnessCheck): boolean {
  if (!existsSync(check.distEntry)) {
    return true;
  }

  const distMtimeMs = statSync(check.distEntry).mtimeMs;
  const latestSourceMtimeMs = Math.max(...check.roots.map((root) => collectLatestMtimeMs(root)), 0);

  return latestSourceMtimeMs > distMtimeMs;
}

export function getBuildTarget(
  targetId: BuildTarget['id'],
  projectRoot = DEFAULT_PROJECT_ROOT
): BuildTarget {
  switch (targetId) {
    case 'openpath-api':
      return {
        id: 'openpath-api',
        projectRoot,
        distEntry: resolve(projectRoot, 'upstream/openpath/api/dist/src/server.js'),
        roots: [
          resolve(projectRoot, 'upstream/openpath/shared/src'),
          resolve(projectRoot, 'upstream/openpath/shared/package.json'),
          resolve(projectRoot, 'upstream/openpath/shared/tsconfig.json'),
          resolve(projectRoot, 'upstream/openpath/api/src'),
          resolve(projectRoot, 'upstream/openpath/api/package.json'),
          resolve(projectRoot, 'upstream/openpath/api/tsconfig.json'),
        ],
        buildCommand:
          'bash scripts/run-openpath.sh npm run build --workspace=@openpath/shared && bash scripts/run-openpath.sh npm run build --workspace=@openpath/api',
      };
    case 'gateway':
      return {
        id: 'gateway',
        projectRoot,
        distEntry: resolve(projectRoot, 'api/dist/server.js'),
        roots: [
          resolve(projectRoot, 'api/src'),
          resolve(projectRoot, 'api/package.json'),
          resolve(projectRoot, 'api/tsconfig.json'),
        ],
        buildCommand: 'cd api && npm run build',
      };
    default:
      throw new Error(`Unsupported build target: ${targetId}`);
  }
}

export function ensureBuildFresh(
  targetId: BuildTarget['id'],
  projectRoot = DEFAULT_PROJECT_ROOT
): { built: boolean; target: BuildTarget } {
  const target = getBuildTarget(targetId, projectRoot);
  if (!isBuildStale(target)) {
    return { built: false, target };
  }

  buildCommandRunner.execSync(target.buildCommand, {
    cwd: target.projectRoot,
    env: process.env,
    stdio: 'inherit',
  });

  return { built: true, target };
}
