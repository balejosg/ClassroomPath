import type { VerifyPlan } from './verify-plan.ts';
import type { VerifyReporter } from './verify-report.ts';
import {
  buildComposeProjectName,
  cleanupStaleVerificationProjects,
  cleanupVerification,
  getVerifyEnv,
  hasPlaywrightBrowsers,
  pickTestDbPort,
  runVerificationPipeline,
  type RunOptions,
  type VerifyRuntime,
} from './verification-stage-runners.ts';

export type { RunOptions, VerifyRuntime } from './verification-stage-runners.ts';
export {
  buildComposeProjectName,
  cleanupStaleVerificationProjects,
  cleanupVerification,
  getVerifyEnv,
  hasPlaywrightBrowsers,
  pickTestDbPort,
} from './verification-stage-runners.ts';

export async function runReleaseAutomationVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime,
  reporter: VerifyReporter
): Promise<void> {
  await runVerificationPipeline('release-automation', plan, env, runtime, reporter);
}

export async function runOpsRegressionVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime,
  reporter: VerifyReporter
): Promise<void> {
  await runVerificationPipeline('ops-regression', plan, env, runtime, reporter);
}

export async function runFullVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime,
  reporter: VerifyReporter
): Promise<void> {
  await runVerificationPipeline('full', plan, env, runtime, reporter);
}
