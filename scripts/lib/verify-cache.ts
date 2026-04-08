import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { VerifyPlan } from './verify-plan.ts';

type VerifyCacheEntry = {
  cacheKey: string;
  id: string;
  passedAt: string;
};

type VerifyCacheState = {
  entries: Record<string, VerifyCacheEntry>;
  version: 1;
};

export type VerifyStageCacheOptions = {
  key: string;
  validate?: () => boolean | Promise<boolean>;
};

function createDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function loadCacheState(cacheFile: string): VerifyCacheState {
  if (!existsSync(cacheFile)) {
    return { entries: {}, version: 1 };
  }

  try {
    const parsed = JSON.parse(readFileSync(cacheFile, 'utf8')) as VerifyCacheState;
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) {
      return { entries: {}, version: 1 };
    }

    return parsed;
  } catch {
    return { entries: {}, version: 1 };
  }
}

export function createVerifyCache(
  plan: VerifyPlan,
  {
    cacheFile = process.env.VERIFY_CACHE_FILE ||
      join(plan.rootDir, '.cache/classroompath', `${plan.mode}-verify-stage-cache.json`),
    now = () => new Date().toISOString(),
  }: {
    cacheFile?: string;
    now?: () => string;
  } = {}
) {
  const normalizedCacheFile = resolve(cacheFile);
  const state = loadCacheState(normalizedCacheFile);

  function flush() {
    mkdirSync(dirname(normalizedCacheFile), { recursive: true });
    writeFileSync(normalizedCacheFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  function buildStageCacheKey(stageId: string, value: unknown = null): string {
    return createDigest({
      planFingerprint: plan.workspaceFingerprint,
      stageId,
      value,
    });
  }

  async function shouldReuse(id: string, options?: VerifyStageCacheOptions): Promise<boolean> {
    if (!options?.key) {
      return false;
    }

    const entry = state.entries[id];
    if (!entry || entry.cacheKey !== options.key) {
      return false;
    }

    if (!options.validate) {
      return true;
    }

    return await options.validate();
  }

  function rememberPassedStage(id: string, cacheKey: string) {
    state.entries[id] = {
      cacheKey,
      id,
      passedAt: now(),
    };
    flush();
  }

  function clearStage(id: string) {
    if (!(id in state.entries)) {
      return;
    }

    delete state.entries[id];
    flush();
  }

  return {
    buildStageCacheKey,
    cacheFile: normalizedCacheFile,
    clearStage,
    rememberPassedStage,
    shouldReuse,
  };
}
