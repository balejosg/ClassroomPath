import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertTextExcludesAll,
  assertTextIncludesAll,
  assertTextSequence,
  extractShellAssignment,
  extractShellFunction,
  findWorkflowJob,
  findWorkflowStepByName,
  readProjectText,
  readProjectWorkflow,
  runProjectCommand,
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

  test('workflow helpers can locate jobs and steps structurally', () => {
    const workflow = readProjectWorkflow('.github/workflows/ci.yml');
    const job = findWorkflowJob(workflow, 'build-and-validate');
    const step = findWorkflowStepByName(job, 'Run CI regression tests');

    assert.equal(step.name, 'Run CI regression tests');
  });

  test('extractShellAssignment returns right-hand-side expressions', () => {
    const helper = readProjectText('scripts/deploy-staging-local.sh');

    assert.equal(
      extractShellAssignment(helper, 'STAGING_HEALTH_CHECK_SCRIPT_PATH'),
      '"$SCRIPT_DIR/check-staging-health.sh"'
    );
  });

  test('runProjectCommand executes child processes with a sanitized git environment', () => {
    const result = runProjectCommand(process.execPath, ['--eval', 'process.stdout.write("ok")']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'ok');
  });
});
