import { spawnSync } from 'node:child_process';
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

export function runCiRegression() {
  runStandaloneRegressionTests(resolveRegressionPlan('ci'));
}

export function runWorkflowConfigRegression() {
  runStandaloneRegressionTests(resolveRegressionPlan('workflow-config'));
}

export function runReleaseAutomationRegression() {
  runStandaloneRegressionTests(resolveRegressionPlan('release-automation'));
}

function runStandaloneRegressionTests(testFiles) {
  for (const testFile of testFiles) {
    runStandaloneRegressionTest(testFile);
  }
}

function runStandaloneRegressionTest(testFile) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', testFile], {
    cwd: projectRoot,
    env: cleanEnv,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
