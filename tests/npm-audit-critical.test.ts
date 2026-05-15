import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  evaluateNpmAuditCritical,
  readAndEvaluateNpmAuditCritical,
} from '../scripts/check-npm-audit-critical.mjs';

test('passes npm audit reports with high but no critical vulnerabilities', () => {
  const result = evaluateNpmAuditCritical({
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 2,
        critical: 0,
        total: 2,
      },
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.reason, /0 critical/);
  assert.match(result.reason, /2 high/);
});

test('fails npm audit reports with critical vulnerabilities', () => {
  const result = evaluateNpmAuditCritical({
    metadata: {
      vulnerabilities: {
        high: 0,
        critical: 1,
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /1 critical/);
});

test('fails closed for missing or corrupt npm audit reports', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-audit-test-'));

  try {
    const corruptPath = join(tempDir, 'corrupt.json');
    writeFileSync(corruptPath, '{not-json', 'utf8');

    assert.equal(evaluateNpmAuditCritical({}).ok, false);
    assert.match(evaluateNpmAuditCritical({ metadata: {} }).reason, /missing/);
    assert.equal(readAndEvaluateNpmAuditCritical(join(tempDir, 'missing.json')).ok, false);
    assert.equal(readAndEvaluateNpmAuditCritical(corruptPath).ok, false);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
