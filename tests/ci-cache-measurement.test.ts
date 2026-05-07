import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  buildCiCacheMeasurement,
  formatCiCacheMeasurementMarkdown,
  normalizeJobsJson,
} from '../scripts/measure-ci-cache.mjs';

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
    jobSamples: [
      {
        workflowName: 'CI',
        jobs: [
          {
            name: 'Product Validation',
            conclusion: 'success',
            steps: [
              {
                name: 'Install ClassroomPath dependencies',
                conclusion: 'success',
                startedAt: '2026-04-22T09:00:00Z',
                completedAt: '2026-04-22T09:00:18Z',
              },
              {
                name: 'Install OpenPath submodule dependencies',
                conclusion: 'success',
                startedAt: '2026-04-22T09:00:18Z',
                completedAt: '2026-04-22T09:00:43Z',
              },
            ],
          },
          {
            name: 'Release Automation Regression',
            conclusion: 'success',
            steps: [
              {
                name: 'Install ClassroomPath dependencies',
                conclusion: 'success',
                started_at: '2026-04-22T09:00:10Z',
                completed_at: '2026-04-22T09:00:26Z',
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(measurement.playwright.browserDownloadCommands, []);
  assert.deepEqual(measurement.playwright.directTestCommands, []);
  assert.equal(measurement.playwright.recommendation.action, 'do-not-add-cache');
  assert.match(measurement.playwright.recommendation.reason, /Do not add Playwright browser cache/);

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

  assert.deepEqual(
    measurement.dependencyInstalls.commands.map((command) => ({
      workflowPath: command.workflowPath,
      jobName: command.jobName,
      stepName: command.stepName,
      workingDirectory: command.workingDirectory,
    })),
    [
      {
        workflowPath: '.github/workflows/ci.yml',
        jobName: 'Product Validation',
        stepName: 'Install ClassroomPath dependencies',
        workingDirectory: '',
      },
      {
        workflowPath: '.github/workflows/ci.yml',
        jobName: 'Product Validation',
        stepName: 'Install OpenPath submodule dependencies',
        workingDirectory: 'upstream/openpath',
      },
      {
        workflowPath: '.github/workflows/ci.yml',
        jobName: 'Ops Regression',
        stepName: 'Install ClassroomPath dependencies',
        workingDirectory: '',
      },
      {
        workflowPath: '.github/workflows/ci.yml',
        jobName: 'Release Automation Regression',
        stepName: 'Install ClassroomPath dependencies',
        workingDirectory: '',
      },
    ]
  );
  assert.deepEqual(
    measurement.dependencyInstalls.timingSamples.map((sample) => ({
      workflowName: sample.workflowName,
      jobName: sample.jobName,
      stepName: sample.stepName,
      durationSeconds: sample.durationSeconds,
    })),
    [
      {
        workflowName: 'CI',
        jobName: 'Product Validation',
        stepName: 'Install ClassroomPath dependencies',
        durationSeconds: 18,
      },
      {
        workflowName: 'CI',
        jobName: 'Product Validation',
        stepName: 'Install OpenPath submodule dependencies',
        durationSeconds: 25,
      },
      {
        workflowName: 'CI',
        jobName: 'Release Automation Regression',
        stepName: 'Install ClassroomPath dependencies',
        durationSeconds: 16,
      },
    ]
  );
  assert.equal(measurement.dependencyInstalls.recommendation.action, 'evaluate-consolidation');
  assert.match(
    measurement.dependencyInstalls.recommendation.reason,
    /dependency install timing samples/
  );
});

test('normalizes gh run view jobs JSON and renders an evidence-first markdown report', () => {
  const normalizedSamples = normalizeJobsJson({
    name: 'CI',
    jobs: [
      {
        name: 'Product Validation',
        conclusion: 'success',
        startedAt: '2026-04-22T09:00:00Z',
        completedAt: '2026-04-22T09:01:30Z',
        steps: [
          {
            name: 'Build ClassroomPath',
            conclusion: 'success',
            startedAt: '2026-04-22T09:00:45Z',
            completedAt: '2026-04-22T09:01:15Z',
          },
        ],
      },
    ],
  });
  const measurement = buildCiCacheMeasurement({
    packageJson: JSON.parse(readText('package.json')),
    workflows: [
      {
        path: '.github/workflows/ci.yml',
        text: readText('.github/workflows/ci.yml'),
      },
    ],
    jobSamples: normalizedSamples,
  });
  const markdown = formatCiCacheMeasurementMarkdown(measurement, {
    runId: '12345',
    source: 'gh run view 12345 --json name,jobs',
  });

  assert.match(markdown, /ClassroomPath CI Timing Measurement for run 12345/);
  assert.match(markdown, /Product Validation \/ Build ClassroomPath: 30s/);
  assert.match(markdown, /Product Validation: 1m 30s/);
  assert.match(markdown, /Do not add Playwright browser cache/);
  assert.match(markdown, /observability only/);
});

test('CI workflow publishes timing metadata without adding dependency installs or cache policy', () => {
  const workflow = readText('.github/workflows/ci.yml');

  assert.match(workflow, /actions: read/);
  assert.match(workflow, /name: Capture CI timing metadata/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /gh run view "\$GITHUB_RUN_ID"/);
  assert.match(workflow, /scripts\/measure-ci-cache\.mjs --jobs-json jobs\.json --format markdown/);
  assert.match(workflow, /name: classroompath-ci-timing-measurement/);
  assert.doesNotMatch(workflow, /Install measurement dependencies/);
  assert.doesNotMatch(workflow, /npm ci --ignore-scripts/);
  assert.doesNotMatch(workflow, /actions\/cache/);
  assert.doesNotMatch(workflow, /playwright\s+install/i);
  assert.doesNotMatch(workflow, /cache:\s*.*playwright/i);
  assert.doesNotMatch(workflow, /playwright-cache/i);
});
