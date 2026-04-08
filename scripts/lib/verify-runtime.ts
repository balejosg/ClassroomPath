import type { VerifyReporter } from './verify-report.ts';
import type { VerifyStageCacheOptions } from './verify-cache.ts';

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
      validate?: VerifyStageCacheOptions['validate'];
      rememberPassedStage: (id: string, cacheKey: string) => void;
      shouldReuse: (id: string, options?: VerifyStageCacheOptions) => Promise<boolean>;
      clearStage: (id: string) => void;
    };
    details?: Record<string, unknown>;
    id: string;
    label: string;
  },
  action: () => Promise<void>
): Promise<void> {
  if (cache && (await cache.shouldReuse(id, { key: cache.key, validate: cache.validate }))) {
    reporter.skipStage(id, label, { ...details, cached: true });
    return;
  }

  reporter.startStage(id, label, details);

  try {
    await action();
    reporter.completeStage(id, label, details);
    if (cache?.key) {
      cache.rememberPassedStage(id, cache.key);
    }
  } catch (error) {
    reporter.failStage(id, label, error);
    cache?.clearStage(id);
    throw error;
  }
}
