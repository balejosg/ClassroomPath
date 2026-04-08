import type { VerifyReporter } from './verify-report.ts';
import type { VerifyStageArtifact, VerifyStageCacheOptions } from './verify-cache.ts';

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type VerifyRuntime = {
  capture: (cmd: string, args: string[], options?: RunOptions) => string;
  run: (cmd: string, args: string[], options?: RunOptions) => Promise<void>;
  runParallel: (commands: string[], options?: RunOptions) => Promise<void>;
  runShell: (command: string, options?: RunOptions) => Promise<void>;
  status: (cmd: string, args: string[], options?: RunOptions) => boolean;
};

export async function runReportedStage(
  reporter: VerifyReporter,
  {
    cache,
    details,
    id,
    label,
  }: {
    cache?: {
      key: string;
      artifacts?: VerifyStageArtifact[];
      validate?: VerifyStageCacheOptions['validate'];
      rememberPassedStage: (
        id: string,
        cacheKey: string,
        artifacts?: VerifyStageArtifact[]
      ) => void;
      shouldReuse: (id: string, options?: VerifyStageCacheOptions) => Promise<boolean>;
      clearStage: (id: string) => void;
    };
    details?: Record<string, unknown>;
    id: string;
    label: string;
  },
  action: () => Promise<void>
): Promise<void> {
  if (
    cache &&
    (await cache.shouldReuse(id, {
      artifacts: cache.artifacts,
      key: cache.key,
      validate: cache.validate,
    }))
  ) {
    reporter.skipStage(id, label, { ...details, cached: true }, cache.artifacts);
    return;
  }

  reporter.startStage(id, label, details);

  try {
    await action();
    reporter.completeStage(id, label, details, cache?.artifacts);
    if (cache?.key) {
      cache.rememberPassedStage(id, cache.key, cache.artifacts);
    }
  } catch (error) {
    reporter.failStage(id, label, error);
    cache?.clearStage(id);
    throw error;
  }
}
