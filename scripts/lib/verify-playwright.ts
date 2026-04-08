import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { VerifyPlan } from './verify-plan.ts';
import type { VerifyRuntime } from './verify-runtime.ts';

function validatePlaywrightReport(reportPath: string): void {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    stats?: { skipped?: number };
  };
  const skipped = Number(report?.stats?.skipped ?? 0);

  if (!Number.isFinite(skipped)) {
    throw new Error('Playwright JSON report did not contain a numeric skipped count.');
  }

  if (skipped > 0) {
    throw new Error(`Playwright verification cannot skip tests; skipped: ${String(skipped)}`);
  }
}

export function hasPlaywrightBrowsers(playwrightCacheDir: string): boolean {
  return (
    existsSync(playwrightCacheDir) &&
    readdirSync(playwrightCacheDir).some((entry) => entry.startsWith('chromium-'))
  );
}

export async function runPlaywrightVerification(
  plan: VerifyPlan,
  env: NodeJS.ProcessEnv,
  runtime: VerifyRuntime
): Promise<void> {
  const reportDir = mkdtempSync(join(tmpdir(), 'classroompath-playwright-report-'));
  const reportPath = join(reportDir, 'report.json');

  try {
    await runtime.run('npx', ['playwright', 'test'], {
      cwd: plan.rootDir,
      env: {
        ...env,
        E2E_SKIP_DB_PUSH: '1',
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        PLAYWRIGHT_WORKERS: String(plan.playwrightWorkers),
      },
    });
    validatePlaywrightReport(reportPath);
  } finally {
    rmSync(reportDir, { force: true, recursive: true });
  }
}
