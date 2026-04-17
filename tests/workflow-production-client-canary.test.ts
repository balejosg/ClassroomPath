import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readProjectText, readProjectWorkflow } from './helpers/ops-contracts.ts';

describe('Production client update canary workflow contracts', () => {
  test('post-release production client update canary stays decoupled from deploy completion', () => {
    const workflowText = readProjectText('.github/workflows/production-client-update-canary.yml');
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};
    const windowsJob = jobs['windows-client-self-update-canary'];
    const linuxJob = jobs['linux-client-self-update-canary'];

    assert.ok(workflow.on?.workflow_run?.workflows?.includes('Deploy'));
    assert.ok(workflow.on?.workflow_run?.types?.includes('completed'));
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.ok(!workflowText.includes('workflow_call:'));
    assert.equal(windowsJob?.['runs-on'], 'windows-latest');
    assert.equal(linuxJob?.['runs-on'], 'ubuntu-latest');
    assert.ok(workflowText.includes('create-production-windows-bootstrap-canary.mjs'));
    assert.ok(
      workflowText.includes('github_actions_remote_read_env_key') &&
        workflowText.includes('Skip production client update canary when billing is manual-only') &&
        workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET') &&
        workflowText.includes('classroompath-production-release')
    );
    assert.ok(
      workflowText.includes('OpenPath.ps1') && workflowText.includes('self-update --silent')
    );
    assert.ok(workflowText.includes('config.json') && workflowText.includes('lastAgentUpdateAt'));
    assert.ok(
      workflowText.includes('/api/enroll/$CLASSROOM_ID') &&
        workflowText.includes('sudo bash "$enroll_script"')
    );
    assert.ok(workflowText.includes('/usr/local/bin/openpath-agent-update.sh --force'));
    assert.ok(workflowText.includes('openpath-agent-update.timer'));
    assert.ok(
      String(windowsJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'")
    );
    assert.ok(
      String(linuxJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'")
    );
  });
});
