import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareToBaseline } from '../scripts/check-scripts-typecheck.mjs';

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
