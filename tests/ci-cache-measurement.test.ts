import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildCiCacheMeasurement } from '../scripts/measure-ci-cache.mjs';

function readText(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('buildCiCacheMeasurement records cache candidates without recommending unsupported caches', () => {
  const measurement = buildCiCacheMeasurement({
    packageJson: JSON.parse(readText('package.json')),
    workflows: [
      {
        path: '.github/workflows/ci.yml',
        text: readText('.github/workflows/ci.yml'),
      },
      {
        path: '.github/workflows/reusable-smoke-test.yml',
        text: readText('.github/workflows/reusable-smoke-test.yml'),
      },
    ],
  });

  assert.deepEqual(measurement.playwright.browserDownloadCommands, []);
  assert.deepEqual(measurement.playwright.directTestCommands, []);
  assert.equal(measurement.playwright.recommendation.action, 'do-not-add-cache');
  assert.match(
    measurement.playwright.recommendation.reason,
    /does not install Playwright browsers/
  );

  assert.deepEqual(
    measurement.turbo.turboBackedCommands.map((command) => ({
      workflowPath: command.workflowPath,
      jobName: command.jobName,
      stepName: command.stepName,
      scriptName: command.scriptName,
    })),
    [
      {
        workflowPath: '.github/workflows/ci.yml',
        jobName: 'Product Validation',
        stepName: 'Build ClassroomPath',
        scriptName: 'build',
      },
    ]
  );
  assert.equal(measurement.turbo.recommendation.action, 'measure-more');
  assert.match(measurement.turbo.recommendation.reason, /at least two successful timing samples/);
});
