import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { readProjectWorkflow } from './helpers/ops-contracts.ts';
import { detectCiRelevantChanges } from '../scripts/detect-ci-relevant-changes.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const volumeSmokePath = resolve(projectRoot, 'scripts/windows-offline-installer-volume-smoke.mjs');

test('fresh-volume installer smoke exercises the real non-root named-volume boundary', () => {
  assert.equal(existsSync(volumeSmokePath), true, 'fresh-volume smoke script must exist');

  const content = readFileSync(volumeSmokePath, 'utf8');
  assert.match(content, /spawn\('docker'/u);
  assert.match(content, /'build',\s*'--file'/u);
  assert.match(content, /\['volume', 'create'/u);
  assert.match(content, /--mount/u);
  assert.match(content, /--user/u);
  assert.match(content, /stat/u);
  assert.match(content, /\['volume', 'rm'/u);
  assert.match(content, /\['image', 'rm'/u);
  assert.doesNotMatch(content, /down\s+-v|volume\s+prune/u);
});

test('Docker-backed CI lane executes the physical named-volume smoke without making it optional', () => {
  const workflow = readProjectWorkflow('.github/workflows/ci.yml');
  const opsRegressionJob = workflow.jobs?.['ops-regression'];
  const smokeStep = (opsRegressionJob?.steps ?? []).find(
    (step) => step.name === 'Run fresh named-volume installer smoke'
  );

  assert.equal(opsRegressionJob?.['runs-on'], 'ubuntu-latest');
  assert.ok(smokeStep, 'Docker-backed ops lane must run the physical volume smoke');
  assert.equal(smokeStep?.run, 'npm run test:windows-offline-installer:volumes');
  assert.notEqual(smokeStep?.['continue-on-error'], true);
});

test('changing the physical volume smoke routes the Docker-backed ops lane', () => {
  assert.equal(
    detectCiRelevantChanges(['scripts/windows-offline-installer-volume-smoke.mjs']).ops_regression,
    'true'
  );
});
