import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRegressionPlan } from './lib/regression-plan.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = dirname(scriptDir);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith('npm_') &&
      key !== 'INIT_CWD' &&
      key !== 'NODE' &&
      key !== 'CODEX_MANAGED_BY_NPM'
  )
);

function createRegressionReporter(planName, testFiles) {
  const reportFile = String(process.env.VERIFY_REPORT_FILE ?? '').trim();
  if (!reportFile) {
    return null;
  }

  const normalizedReportFile = resolve(reportFile);
  const state = {
    composeProjectName: 'ci-regression',
    coverage: {
      needsApiCoverage: false,
      needsCoverageGate: false,
      needsSpaCoverage: false,
    },
    mode: 'commit',
    notes: [`regression-plan=${planName}`],
    ok: null,
    reportFile: normalizedReportFile,
    rootDir: projectRoot,
    scope: planName,
    stages: testFiles.map((testFile) => ({
      id: testFile,
      label: testFile,
      status: 'pending',
    })),
    startedAt: new Date().toISOString(),
    testDbPort: 0,
    version: 1,
  };

  function flush() {
    mkdirSync(dirname(normalizedReportFile), { recursive: true });
    writeFileSync(normalizedReportFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  flush();

  return {
    completeStage(testFile) {
      const stage = state.stages.find((entry) => entry.id === testFile);
      if (!stage) return;
      stage.finishedAt = new Date().toISOString();
      stage.startedAt ||= stage.finishedAt;
      stage.status = 'passed';
      flush();
    },
    failStage(testFile, error) {
      const stage = state.stages.find((entry) => entry.id === testFile);
      if (!stage) return;
      stage.error = error instanceof Error ? error.message : String(error);
      stage.finishedAt = new Date().toISOString();
      stage.startedAt ||= stage.finishedAt;
      stage.status = 'failed';
      flush();
    },
    finalize(ok) {
      state.finishedAt = new Date().toISOString();
      state.ok = ok;
      flush();
    },
    startStage(testFile) {
      const stage = state.stages.find((entry) => entry.id === testFile);
      if (!stage) return;
      stage.startedAt = new Date().toISOString();
      stage.status = 'running';
      flush();
    },
  };
}

export function runCiRegression() {
  runStandaloneRegressionTests('ci', resolveRegressionPlan('ci'));
}

export function runWorkflowConfigRegression() {
  runStandaloneRegressionTests('workflow-config', resolveRegressionPlan('workflow-config'));
}

export function runReleaseAutomationRegression() {
  runStandaloneRegressionTests('release-automation', resolveRegressionPlan('release-automation'));
}

function runStandaloneRegressionTests(planName, testFiles) {
  const reporter = createRegressionReporter(planName, testFiles);

  for (const testFile of testFiles) {
    runStandaloneRegressionTest(testFile, reporter);
  }

  reporter?.finalize(true);
}

function runStandaloneRegressionTest(testFile, reporter) {
  reporter?.startStage(testFile);
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', testFile], {
    cwd: projectRoot,
    env: cleanEnv,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    reporter?.failStage(
      testFile,
      new Error(`${testFile} exited with code ${String(result.status)}`)
    );
    reporter?.finalize(false);
    process.exit(result.status ?? 1);
  }

  reporter?.completeStage(testFile);
}
