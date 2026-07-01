import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareToBaseline,
  isRatchetOwnedFile,
  parseTscOutput,
} from '../scripts/check-scripts-typecheck.mjs';

test('flags a file whose current error count exceeds the baseline as a regression', () => {
  const result = compareToBaseline({ 'scripts/foo.mjs': 5 }, { 'scripts/foo.mjs': 2 });

  assert.equal(result.regressions.length, 1);
  assert.deepEqual(result.regressions[0], {
    baselineCount: 2,
    currentCount: 5,
    file: 'scripts/foo.mjs',
  });
  assert.equal(result.newFilesWithErrors.length, 0);
  assert.equal(result.improvements.length, 0);
});

test('flags a new file with errors that is absent from the baseline', () => {
  const result = compareToBaseline(
    { 'scripts/brand-new.mjs': 3, 'scripts/foo.mjs': 2 },
    { 'scripts/foo.mjs': 2 }
  );

  assert.equal(result.regressions.length, 0);
  assert.equal(result.newFilesWithErrors.length, 1);
  assert.deepEqual(result.newFilesWithErrors[0], {
    currentCount: 3,
    file: 'scripts/brand-new.mjs',
  });
  assert.equal(result.improvements.length, 0);
});

test('reports a file under baseline as an improvement without failing', () => {
  const result = compareToBaseline({ 'scripts/foo.mjs': 1 }, { 'scripts/foo.mjs': 2 });

  assert.equal(result.regressions.length, 0);
  assert.equal(result.newFilesWithErrors.length, 0);
  assert.equal(result.improvements.length, 1);
  assert.deepEqual(result.improvements[0], {
    baselineCount: 2,
    currentCount: 1,
    file: 'scripts/foo.mjs',
  });
});

test('treats a file fully paid down to zero errors (absent from current) as an improvement', () => {
  const result = compareToBaseline({}, { 'scripts/foo.mjs': 2 });

  assert.equal(result.regressions.length, 0);
  assert.equal(result.newFilesWithErrors.length, 0);
  assert.equal(result.improvements.length, 1);
  assert.deepEqual(result.improvements[0], {
    baselineCount: 2,
    currentCount: 0,
    file: 'scripts/foo.mjs',
  });
});

test('reports no findings when current counts exactly match the baseline', () => {
  const result = compareToBaseline(
    { 'scripts/foo.mjs': 2, 'scripts/bar.mjs': 0 },
    { 'scripts/foo.mjs': 2 }
  );

  assert.equal(result.regressions.length, 0);
  assert.equal(result.newFilesWithErrors.length, 0);
  assert.equal(result.improvements.length, 0);
});

test('handles multiple files independently across regressions, new files, and improvements', () => {
  const result = compareToBaseline(
    {
      'scripts/improved.mjs': 1,
      'scripts/new-broken.mjs': 4,
      'scripts/regressed.mjs': 6,
      'scripts/stable.mjs': 3,
    },
    {
      'scripts/improved.mjs': 3,
      'scripts/regressed.mjs': 2,
      'scripts/stable.mjs': 3,
    }
  );

  assert.deepEqual(
    result.regressions.map((entry) => entry.file),
    ['scripts/regressed.mjs']
  );
  assert.deepEqual(
    result.newFilesWithErrors.map((entry) => entry.file),
    ['scripts/new-broken.mjs']
  );
  assert.deepEqual(
    result.improvements.map((entry) => entry.file),
    ['scripts/improved.mjs']
  );
});

test('isRatchetOwnedFile counts scripts/ + non-e2e/non-helpers tests/ and drops build-dependent files', () => {
  // owned — build-state-independent, the ratchet gates on these
  assert.equal(isRatchetOwnedFile('scripts/lib/foo.mjs'), true);
  assert.equal(isRatchetOwnedFile('tests/release-status.test.ts'), true);
  assert.equal(isRatchetOwnedFile('./scripts/foo.mjs'), true);
  // NOT owned — transitively-pulled workspace source + Playwright e2e/fixtures, whose tsc error
  // counts vary with workspace build state (non-deterministic across CI runs)
  assert.equal(isRatchetOwnedFile('api/src/openpath/domain.ts'), false);
  assert.equal(isRatchetOwnedFile('react-spa/src/data/pricing-data.ts'), false);
  assert.equal(isRatchetOwnedFile('tests/e2e/fixtures/accounts.ts'), false);
  assert.equal(isRatchetOwnedFile('tests/helpers/e2e-runtime.ts'), false);
});

test('parseTscOutput ignores errors in non-owned files so the count is deterministic', () => {
  const output = [
    "scripts/foo.mjs(1,1): error TS2339: Property 'x' does not exist.",
    'tests/bar.test.ts(2,2): error TS2322: Type mismatch.',
    'api/src/openpath/domain.ts(3,3): error TS2345: Bad arg.',
    'tests/e2e/fixtures/accounts.ts(4,4): error TS2322: Type mismatch.',
    'tests/helpers/e2e-runtime.ts(5,5): error TS2339: Nope.',
  ].join('\n');

  assert.deepEqual(parseTscOutput(output), {
    'scripts/foo.mjs': 1,
    'tests/bar.test.ts': 1,
  });
});
