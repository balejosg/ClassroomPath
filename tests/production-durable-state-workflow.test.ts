import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const transactionHelper = resolve(projectRoot, 'scripts/lib/deployment-transaction.sh');

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

type RollbackScenario = {
  name: string;
  deployResult: 'failure' | 'success';
  recoveryResult: 'success';
  smokeResult: 'failure' | 'success' | 'skipped';
  phase: string;
  durableCandidateSha: string;
  durableReleaseId: string;
  expectedReleaseId: string;
  durableTransactionId: string;
  jobTransactionId: string;
  expected: boolean;
};

test('production rollback workflow requires exact durable COMMITTED identity', () => {
  const workflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf8');
  const deployJob = workflow.match(/  deploy-production:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u)?.[0];
  const rollbackJob = workflow.match(/  rollback-production:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u)?.[0];

  assert.ok(deployJob, 'production deploy job should be present');
  assert.ok(rollbackJob, 'production rollback job should be present');
  assert.match(deployJob, /durable_phase:.*read-durable-deployment-state\.outputs\.phase/u);
  assert.match(
    deployJob,
    /durable_candidate_sha:.*read-durable-deployment-state\.outputs\.candidate_sha/u
  );
  assert.match(
    deployJob,
    /durable_release_id:.*read-durable-deployment-state\.outputs\.release_id/u
  );
  assert.match(
    deployJob,
    /durable_transaction_id:.*read-durable-deployment-state\.outputs\.transaction_id/u
  );
  assert.match(deployJob, /transaction_id:.*steps\.resolve\.outputs\.transaction_id/u);
  assert.match(deployJob, /DEPLOYMENT_TRANSACTION_ID:.*steps\.resolve\.outputs\.transaction_id/u);
  assert.match(deployJob, /sha256sum/u);
  assert.match(deployJob, /id: read-durable-deployment-state/u);
  assert.match(deployJob, /if: always\(\)/u);

  const rollbackCondition = rollbackJob.match(/\n\s+if: ([^\n]+)/u)?.[1] ?? '';
  const requiredPredicates = [
    "needs.deploy-production.result == 'failure'",
    "needs.deploy-production.outputs.durable_phase != 'COMMITTED'",
    'needs.deploy-production.outputs.durable_candidate_sha != github.sha',
    'needs.deploy-production.outputs.durable_release_id != needs.resolve-release-images.outputs.release_id',
    'needs.deploy-production.outputs.durable_transaction_id != needs.deploy-production.outputs.transaction_id',
    "needs.smoke-test-production.result == 'failure'",
  ];
  for (const predicate of requiredPredicates) {
    assert.match(
      rollbackCondition,
      new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
      `rollback condition should contain ${predicate}`
    );
  }

  const readStateStep = deployJob.match(
    /      - name: Read durable deployment state[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u
  )?.[0];
  assert.ok(readStateStep, 'durable deployment state read step should be present');
  const runMarker = '\n        run: |\n';
  const runStart = readStateStep.indexOf(runMarker);
  assert.ok(runStart >= 0, 'durable deployment state step should have a shell body');
  const readStateScript = readStateStep
    .slice(runStart + runMarker.length)
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n')
    .trim();

  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-durable-state-workflow-'));
  const stateDir = join(tempDir, 'release-state');
  const stateFile = join(stateDir, 'deployment-phase.env');
  const historyFile = join(stateDir, 'deployment-history.log');
  const outputFile = join(tempDir, 'github-output');
  const binDir = join(tempDir, 'bin');
  const keyPath = join(tempDir, 'ssh-key');
  const previousId = 'a'.repeat(64);
  const releaseId = 'b'.repeat(64);
  const githubSha = 'c'.repeat(40);
  const transactionId = 'd'.repeat(64);

  try {
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeExecutable(
      join(binDir, 'ssh'),
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'cat "$FIXTURE_STATE_FILE"', ''].join('\n')
    );
    const initResult = spawnSync(
      'bash',
      [
        '-c',
        [
          'set -Eeuo pipefail',
          'source "$1"',
          'export DEPLOYMENT_TRANSACTION_FILE="$2"',
          'export DEPLOYMENT_TRANSACTION_HISTORY_FILE="$3"',
          'export CANDIDATE_SHA="$4"',
          'deployment_transaction_init "$2" "$5" "$6" "$7"',
        ].join('\n'),
        'durable-state-init',
        transactionHelper,
        stateFile,
        historyFile,
        githubSha,
        previousId,
        releaseId,
        transactionId,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(initResult.status, 0, `${initResult.stdout}\n${initResult.stderr}`);
    const isolatedReadStateScript = readStateScript.replaceAll(
      '~/.ssh/classroompath-production-phase',
      `'${keyPath}'`
    );
    assert.doesNotMatch(isolatedReadStateScript, /~\/\.ssh\/classroompath-production-phase/u);
    assert.match(
      isolatedReadStateScript,
      new RegExp(keyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u')
    );

    const readState = (expectedPhase: string | null, deployRoot = tempDir) => {
      writeFileSync(outputFile, '', 'utf8');
      const result = spawnSync('bash', ['-c', isolatedReadStateScript], {
        cwd: projectRoot,
        env: {
          ...process.env,
          DEPLOY_HOST: '127.0.0.1',
          DEPLOY_PORT: '22',
          DEPLOY_ROOT: deployRoot,
          DEPLOY_SSH_KEY: 'fixture-key',
          DEPLOY_USER: 'fixture-user',
          FIXTURE_STATE_FILE: stateFile,
          GITHUB_OUTPUT: outputFile,
          PATH: `${binDir}:/usr/bin:/bin`,
        },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const output = readFileSync(outputFile, 'utf8');
      if (expectedPhase === null) return output;
      assert.match(output, new RegExp(`^phase=${expectedPhase}$`, 'mu'));
      assert.match(output, new RegExp(`^candidate_sha=${githubSha}$`, 'mu'));
      assert.match(output, new RegExp(`^release_id=${releaseId}$`, 'mu'));
      assert.match(output, new RegExp(`^transaction_id=${transactionId}$`, 'mu'));
      return output;
    };

    const missingRootOutput = readState(null, '');
    assert.match(missingRootOutput, /^phase=UNKNOWN$/mu);
    assert.match(missingRootOutput, /^candidate_sha=UNKNOWN$/mu);
    assert.match(missingRootOutput, /^release_id=UNKNOWN$/mu);
    assert.match(missingRootOutput, /^transaction_id=UNKNOWN$/mu);
    readState('PREPARED');

    const commitResult = spawnSync(
      'bash',
      [
        '-c',
        [
          'set -Eeuo pipefail',
          'source "$1"',
          'export DEPLOYMENT_TRANSACTION_FILE="$2"',
          'export DEPLOYMENT_TRANSACTION_HISTORY_FILE="$3"',
          'set -a',
          '. "$2"',
          'set +a',
          'deployment_transaction_transition SWITCHING SWITCH',
          'deployment_transaction_transition ACTIVATED_UNVERIFIED SWITCH',
          'deployment_transaction_transition VERIFIED VERIFY',
          'deployment_transaction_transition COMMITTED COMMIT',
        ].join('\n'),
        'durable-state-commit',
        transactionHelper,
        stateFile,
        historyFile,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(commitResult.status, 0, `${commitResult.stdout}\n${commitResult.stderr}`);
    readState('COMMITTED');

    const evaluateWorkflowCondition = (scenario: RollbackScenario) => {
      let expression = rollbackCondition;
      const substitutions: Record<string, string> = {
        'needs.deploy-production.outputs.durable_candidate_sha': scenario.durableCandidateSha,
        'needs.deploy-production.outputs.durable_transaction_id': scenario.durableTransactionId,
        'needs.resolve-release-images.outputs.release_id': scenario.expectedReleaseId,
        'needs.deploy-production.outputs.durable_release_id': scenario.durableReleaseId,
        'needs.deploy-production.outputs.durable_phase': scenario.phase,
        'needs.deploy-production.outputs.transaction_id': scenario.jobTransactionId,
        'needs.prepare-production-recovery.result': scenario.recoveryResult,
        'needs.deploy-production.result': scenario.deployResult,
        'needs.smoke-test-production.result': scenario.smokeResult,
        'github.sha': githubSha,
        'always()': 'true',
      };
      for (const token of Object.keys(substitutions).sort((a, b) => b.length - a.length)) {
        expression = expression.replaceAll(token, JSON.stringify(substitutions[token]));
      }
      assert.doesNotMatch(expression, /needs\.|github\.sha|always\(\)/u);
      const result = spawnSync(
        'bash',
        ['-c', `if [[ ${expression} ]]; then exit 0; else exit 1; fi`],
        { cwd: projectRoot, encoding: 'utf8' }
      );
      assert.equal(result.error, undefined, `${result.stdout}\n${result.stderr}`);
      return result.status === 0;
    };

    const exactCommitted: Omit<RollbackScenario, 'name' | 'expected'> = {
      deployResult: 'failure',
      recoveryResult: 'success',
      smokeResult: 'skipped',
      phase: 'COMMITTED',
      durableCandidateSha: githubSha,
      durableReleaseId: releaseId,
      expectedReleaseId: releaseId,
      durableTransactionId: transactionId,
      jobTransactionId: transactionId,
    };
    const scenarios: RollbackScenario[] = [
      { name: 'exact committed candidate failure', ...exactCommitted, expected: false },
      {
        name: 'durable phase mismatch',
        ...exactCommitted,
        phase: 'VERIFIED',
        expected: true,
      },
      {
        name: 'candidate SHA mismatch',
        ...exactCommitted,
        durableCandidateSha: 'e'.repeat(40),
        expected: true,
      },
      {
        name: 'release identity mismatch',
        ...exactCommitted,
        durableReleaseId: 'f'.repeat(64),
        expected: true,
      },
      {
        name: 'transaction identity mismatch',
        ...exactCommitted,
        durableTransactionId: '1'.repeat(64),
        expected: true,
      },
      {
        name: 'missing durable outputs',
        ...exactCommitted,
        phase: 'UNKNOWN',
        durableCandidateSha: 'UNKNOWN',
        durableReleaseId: 'UNKNOWN',
        durableTransactionId: 'UNKNOWN',
        expected: true,
      },
      {
        name: 'smoke failure after exact commit',
        ...exactCommitted,
        deployResult: 'success',
        smokeResult: 'failure',
        expected: true,
      },
      {
        name: 'successful deploy and smoke',
        ...exactCommitted,
        deployResult: 'success',
        smokeResult: 'success',
        expected: false,
      },
    ];
    for (const scenario of scenarios) {
      assert.equal(evaluateWorkflowCondition(scenario), scenario.expected, scenario.name);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
