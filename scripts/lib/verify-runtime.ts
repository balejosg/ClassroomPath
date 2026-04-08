import type { VerifyReporter } from './verify-report.ts';

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
    details,
    id,
    label,
  }: {
    details?: Record<string, unknown>;
    id: string;
    label: string;
  },
  action: () => Promise<void>
): Promise<void> {
  reporter.startStage(id, label, details);

  try {
    await action();
    reporter.completeStage(id, label, details);
  } catch (error) {
    reporter.failStage(id, label, error);
    throw error;
  }
}
