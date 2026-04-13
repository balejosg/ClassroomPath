import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertTextExcludesAll,
  assertTextIncludesAll,
  assertTextSequence,
  extractShellFunction,
  readProjectText,
  readProjectWorkflow,
} from './helpers/ops-contracts.ts';

describe('Ops contracts helpers', () => {
  test('can read repo text and workflow fixtures through the shared helper', () => {
    const deployScript = readProjectText('scripts/deploy-staging-local.sh');
    const workflow = readProjectWorkflow('.github/workflows/ci.yml');

    assert.match(deployScript, /deploy-staging-local\.sh/);
    assert.ok(workflow.jobs?.['ci-success'], 'expected CI workflow to expose ci-success job');
  });

  test('assertion helpers validate includes, excludes, and ordering', () => {
    const sample = ['alpha', 'beta', 'gamma'].join('\n');

    assertTextIncludesAll(sample, ['alpha', 'gamma'], 'sample should include required tokens');
    assertTextExcludesAll(sample, ['delta'], 'sample should not include excluded tokens');
    assertTextSequence(sample, ['alpha', 'beta', 'gamma'], 'sample should preserve token order');
  });

  test('extractShellFunction returns the exact shell function body', () => {
    const helper = readProjectText('scripts/lib/deploy-payload.sh');

    assert.match(extractShellFunction(helper, 'decode_deploy_payload_base64'), /\(\) \{/);
  });
});
