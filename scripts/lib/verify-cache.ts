import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { VerifyPlan } from './verify-plan.ts';

export type VerifyStageArtifact = {
  kind: string;
  path: string;
  required?: boolean;
};

type VerifyCacheEntry = {
  artifacts: VerifyStageArtifact[];
  cacheKey: string;
  id: string;
  passedAt: string;
};

type VerifyCacheState = {
  entries: Record<string, VerifyCacheEntry>;
  version: 1;
};

export type VerifyStageCacheOptions = {
  artifacts?: VerifyStageArtifact[];
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

    return {
      entries: Object.fromEntries(
        Object.entries(parsed.entries).map(([id, entry]) => [
          id,
          {
            artifacts: Array.isArray(entry?.artifacts) ? entry.artifacts : [],
            cacheKey: String(entry?.cacheKey ?? ''),
            id: String(entry?.id ?? id),
            passedAt: String(entry?.passedAt ?? ''),
          },
        ])
      ),
      version: 1,
    };
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
      return entry.artifacts.every(
        (artifact) => artifact.required === false || existsSync(resolve(artifact.path))
      );
    }

    if (
      !entry.artifacts.every(
        (artifact) => artifact.required === false || existsSync(resolve(artifact.path))
      )
    ) {
      return false;
    }

    return await options.validate();
  }

  function rememberPassedStage(
    id: string,
    cacheKey: string,
    artifacts: VerifyStageArtifact[] = []
  ) {
    state.entries[id] = {
      artifacts: artifacts.map((artifact) => ({
        kind: artifact.kind,
        path: resolve(artifact.path),
        required: artifact.required,
      })),
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
