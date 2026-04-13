import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveRegressionPlan } from '../scripts/lib/regression-plan.mjs';
import { readProjectJson, runProjectCommand, readProjectText } from './helpers/ops-contracts.ts';

type PackageDefinition = {
  scripts?: Record<string, string>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const verifyDocsScriptPath = resolve(projectRoot, 'scripts/verify-docs.mjs');

describe('docs verification contracts', () => {
  test('package and regression plans wire the maintained-doc verifier', () => {
    const packageJson = readProjectJson<PackageDefinition>('package.json');
    const ciPlan = resolveRegressionPlan('ci');

    assert.ok(existsSync(verifyDocsScriptPath), 'scripts/verify-docs.mjs should exist');
    assert.equal(packageJson.scripts?.['verify:docs'], 'node scripts/verify-docs.mjs');
    assert.ok(
      ciPlan.includes('tests/docs-verification.test.ts'),
      'CI regression should include docs-verification.test.ts'
    );
  });

  test('canonical index lists every maintained ADR explicitly', () => {
    const docsIndex = readProjectText('docs/INDEX.md');

    assert.ok(
      docsIndex.includes('docs/adr/0001-cross-system-mutation-ledger.md'),
      'docs/INDEX.md should link ADR 0001 explicitly'
    );
    assert.ok(
      docsIndex.includes('docs/adr/0002-release-risk-gating.md'),
      'docs/INDEX.md should link ADR 0002 explicitly'
    );
    assert.ok(
      docsIndex.includes('docs/evaluation/es/guia-evaluacion-centros.md'),
      'docs/INDEX.md should link the maintained Spanish evaluation guide explicitly'
    );
    assert.ok(
      docsIndex.includes('maintained Spanish exception'),
      'docs/INDEX.md should document the maintained Spanish exception'
    );
  });

  test('verify-docs passes for the maintained ClassroomPath doc set', () => {
    const result = runProjectCommand('node', ['scripts/verify-docs.mjs']);

    assert.equal(result.status, 0, result.stderr || result.stdout || 'verify-docs should pass');
    assert.match(
      result.stdout,
      /Documentation verification passed for \d+ Markdown files\./,
      'verify-docs should report the Markdown file count'
    );
  });
});
