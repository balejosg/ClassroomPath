import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const ciRegressionTestFiles = [
  'tests/agent-docs-consistency.test.ts',
  'tests/deployment.test.ts',
  'tests/firefox-release-version.test.ts',
  'tests/firefox-release-metadata.test.ts',
  'tests/openpath-required-checks.test.ts',
  'tests/release-evidence.test.ts',
  'tests/release-images.test.ts',
  'tests/release-gate-policy.test.ts',
  'tests/wait-for-release-candidate.test.ts',
];

const releaseAutomationRegressionTestFiles = [
  ...ciRegressionTestFiles,
  'tests/verify-plan.test.ts',
  'tests/workflow-config.test.ts',
];

export function runCiRegression() {
  runStandaloneRegressionTests(ciRegressionTestFiles);
}

export function runWorkflowConfigRegression() {
  runStandaloneRegressionTest('tests/workflow-config.test.ts');
}

export function runReleaseAutomationRegression() {
  runStandaloneRegressionTests(releaseAutomationRegressionTestFiles);
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
