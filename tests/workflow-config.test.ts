import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

type WorkflowJob = {
  name?: string;
  needs?: string | string[];
  steps?: Array<{
    name?: string;
    run?: string;
    'working-directory'?: string;
  }>;
};

type WorkflowDefinition = {
  concurrency?: string | { group?: string; 'cancel-in-progress'?: boolean };
  on?: {
    push?: {
      branches?: string[];
      tags?: string[];
    };
  };
  jobs?: Record<string, WorkflowJob>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

function readWorkflow(relativePath: string): WorkflowDefinition {
  const workflowPath = resolve(projectRoot, relativePath);
  assert.ok(existsSync(workflowPath), `${relativePath} should exist`);
  return parseYaml(readFileSync(workflowPath, 'utf-8')) as WorkflowDefinition;
}

function normalizeNeeds(needs: WorkflowJob['needs']): string[] {
  if (!needs) {
    return [];
  }

  return Array.isArray(needs) ? needs : [needs];
}

describe('Workflow configuration hardening', () => {
  test('CI workflow exists and defines a stable CI Success summary job', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const jobs = workflow.jobs ?? {};

    assert.ok(jobs['detect-relevant-changes'], 'CI workflow should detect relevant changes');
    assert.equal(jobs['ci-success']?.name, 'CI Success');
  });

  test('CI workflow installs OpenPath submodule dependencies before building', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml');
    const buildJob = workflow.jobs?.['build-and-validate'];
    const steps = buildJob?.steps ?? [];

    const classroomPathInstall = steps.find(
      (step) => step.name === 'Install ClassroomPath dependencies'
    );
    const openPathInstall = steps.find(
      (step) => step.name === 'Install OpenPath submodule dependencies'
    );

    assert.equal(classroomPathInstall?.run, 'npm ci');
    assert.equal(openPathInstall?.run, 'npm ci');
    assert.equal(openPathInstall?.['working-directory'], 'upstream/openpath');
  });

  test('Deploy workflow serializes production releases', () => {
    const workflow = readWorkflow('.github/workflows/deploy.yml');
    const concurrency = workflow.concurrency;

    assert.equal(typeof concurrency, 'object', 'Deploy workflow should define object concurrency');
    assert.match(
      (concurrency as { group?: string }).group ?? '',
      /production/i,
      'Deploy workflow concurrency group should target production deploys'
    );
    assert.equal(
      (concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'],
      false,
      'Production deploys should not cancel in-progress releases'
    );
  });

  test('Deploy workflow builds release images before deployment and defines rollback', () => {
    const workflow = readWorkflow('.github/workflows/deploy.yml');
    const jobs = workflow.jobs ?? {};

    assert.ok(
      jobs['resolve-release-images'],
      'Deploy workflow should resolve immutable release images'
    );
    assert.ok(jobs['deploy-production'], 'Deploy workflow should still deploy to production');
    assert.ok(jobs['smoke-test-production'], 'Deploy workflow should smoke test production');
    assert.ok(
      jobs['rollback-production'],
      'Deploy workflow should define rollback after smoke failure'
    );

    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(
      deployNeeds.includes('resolve-release-images'),
      'deploy-production should depend on resolve-release-images'
    );
    assert.ok(
      deployNeeds.includes('release-gate-staging'),
      'deploy-production should still depend on release-gate-staging'
    );

    assert.ok(
      jobs['release-evidence'],
      'Deploy workflow should publish a release-evidence summary artifact'
    );

    const evidenceNeeds = normalizeNeeds(jobs['release-evidence']?.needs);
    assert.ok(
      evidenceNeeds.includes('deploy-production'),
      'release-evidence should depend on deploy-production'
    );
    assert.ok(
      evidenceNeeds.includes('resolve-release-images'),
      'release-evidence should depend on resolve-release-images'
    );
    assert.ok(
      evidenceNeeds.includes('smoke-test-production'),
      'release-evidence should depend on smoke-test-production'
    );
    assert.ok(
      evidenceNeeds.includes('rollback-production'),
      'release-evidence should depend on rollback-production'
    );
  });

  test('Release candidate workflow builds images for main before a production tag exists', () => {
    const workflow = readWorkflow('.github/workflows/release-candidate-images.yml');
    const jobs = workflow.jobs ?? {};

    assert.ok(
      workflow.on?.push?.branches?.includes('main'),
      'release candidate workflow should trigger on pushes to main'
    );
    assert.ok(
      jobs['build-release-candidates'],
      'release candidate workflow should build candidate images'
    );

    const concurrency = workflow.concurrency;
    assert.equal(
      typeof concurrency,
      'object',
      'release candidate workflow should define object concurrency'
    );
    assert.equal(
      (concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'],
      true,
      'release candidate workflow should cancel superseded main builds'
    );
  });
});
