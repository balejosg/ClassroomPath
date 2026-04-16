import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getVerificationPipelineDefinition,
  getVerificationStageDefinition,
} from '../scripts/lib/verification-catalog.mjs';
import {
  isStageCacheEnabled,
  listVerificationStageRunnerIds,
  resolvePlaywrightVerificationCommand,
  runVerificationPipeline,
} from '../scripts/lib/verification-stage-runners.ts';

function buildPlanFixture(
  scope: 'release-automation' | 'ops-regression' | 'full' = 'release-automation'
) {
  return {
    browsersAvailable: true,
    composeFile: 'docker/docker-compose.test.yml',
    composeProjectName: 'classroompath_test_fixture',
    domainSummary: {
      matchedDomains: [],
      owners: ['release-engineering'],
      releaseGates: ['staging-release-gate', 'production-release-gate'],
      requiredApprovals: ['release-engineering'],
      reviewers: ['release-engineering'],
    },
    mode: 'commit',
    e2eDepth: scope === 'full' ? 'commit-smoke' : 'skip',
    needsApiCoverage: false,
    needsCoverageGate: false,
    needsSpaCoverage: false,
    playwrightCacheDir: '/tmp/playwright',
    playwrightWorkers: 3,
    rootDir: process.cwd(),
    skipOpenPathStatic: false,
    stagedFiles: [],
    submoduleOnly: false,
    testDbPort: 54321,
    verificationScope: scope,
    workspaceFingerprint: 'fixture-fingerprint',
  };
}

describe('verification pipeline', () => {
  test('catalog defines runner-backed pipelines for every verification scope', () => {
    const releaseAutomation = getVerificationPipelineDefinition('release-automation');
    const opsRegression = getVerificationPipelineDefinition('ops-regression');
    const full = getVerificationPipelineDefinition('full');

    assert.deepEqual(
      releaseAutomation?.stages.map((stage) => stage.id),
      ['format-and-secrets', 'release-automation-regression']
    );
    assert.deepEqual(
      opsRegression?.stages.map((stage) => stage.runner),
      ['format-and-secrets', 'ops-regression']
    );
    assert.deepEqual(full?.beforeAll, [
      'cleanup-stale-verification-projects',
      'cleanup-verification',
    ]);
    assert.deepEqual(getVerificationStageDefinition('full', 'playwright-e2e')?.before, [
      'stop-openpath-api',
      'kill-orphaned-dev-ports',
    ]);
  });

  test('runner registry exposes every stage runner referenced by the catalog', () => {
    const pipelineStageRunners = [
      ...getVerificationPipelineDefinition('full').stages,
      ...getVerificationPipelineDefinition('ops-regression').stages,
      ...getVerificationPipelineDefinition('release-automation').stages,
    ].map((stage) => stage.runner);

    for (const runner of new Set(pipelineStageRunners)) {
      assert.ok(
        listVerificationStageRunnerIds().includes(runner),
        `stage runner registry should include ${runner}`
      );
    }
  });

  test('release automation pipeline executes the declarative stage order', async () => {
    const events: string[] = [];
    const cacheFile = join(
      tmpdir(),
      `classroompath-verification-pipeline-${Date.now()}-${Math.random()}.json`
    );
    const plan = buildPlanFixture();
    plan.workspaceFingerprint = `verification-pipeline-${Date.now()}-${Math.random()}`;

    await runVerificationPipeline(
      'release-automation',
      plan,
      { VERIFY_CACHE_FILE: cacheFile },
      {
        capture: () => '',
        run: async (cmd, args) => {
          events.push(`run:${cmd} ${args.join(' ')}`);
        },
        runParallel: async (commands) => {
          events.push(`parallel:${commands.join(' && ')}`);
        },
        runShell: async (command) => {
          events.push(`shell:${command}`);
        },
        status: () => true,
      },
      {
        completeStage: (id: string) => events.push(`complete:${id}`),
        failStage: (id: string) => events.push(`fail:${id}`),
        skipStage: (id: string) => events.push(`skip:${id}`),
        startStage: (id: string) => events.push(`start:${id}`),
      } as never
    );

    rmSync(cacheFile, { force: true });

    assert.deepEqual(events, [
      'start:format-and-secrets',
      'parallel:npm run format:check && npm run security:secrets && npm run verify:docs',
      'complete:format-and-secrets',
      'start:release-automation-regression',
      'run:npm run test:release-automation',
      'complete:release-automation-regression',
    ]);
  });

  test('full pipeline resolves e2e command from verification mode', () => {
    const plan = buildPlanFixture('full');
    assert.equal(resolvePlaywrightVerificationCommand(plan), 'npm run test:e2e:commit-smoke');

    plan.mode = 'fast';
    plan.e2eDepth = 'skip';
    assert.equal(resolvePlaywrightVerificationCommand(plan), null);

    plan.mode = 'release';
    plan.e2eDepth = 'full';
    assert.equal(resolvePlaywrightVerificationCommand(plan), 'npm run test:e2e:full');
  });

  test('release mode disables diff-safe stage cache', () => {
    const plan = buildPlanFixture('full');
    assert.equal(isStageCacheEnabled(plan, 'build'), true);

    plan.mode = 'release';
    assert.equal(isStageCacheEnabled(plan, 'build'), false);
  });
});
