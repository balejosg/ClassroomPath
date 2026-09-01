import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const projectRoot = resolve(import.meta.dirname, '..');
const deployWorkflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf8');
const authorityWorkflowPath = resolve(
  projectRoot,
  '.github/workflows/production-recovery-authority.yml'
);
const authorityScriptPath = resolve(projectRoot, 'scripts/production-recovery-authority.sh');
const promotionScriptPath = resolve(
  projectRoot,
  'scripts/promote-production-recovery-authority.sh'
);
const artifactHelper = readFileSync(
  resolve(projectRoot, 'scripts/lib/production-recovery-artifact.sh'),
  'utf8'
);
const transactionHelper = readFileSync(
  resolve(projectRoot, 'scripts/lib/deployment-transaction.sh'),
  'utf8'
);
const rollbackScript = readFileSync(
  resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
  'utf8'
);

function recoveryJob(): string {
  return (
    deployWorkflow.match(/  prepare-production-recovery:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u)?.[0] ?? ''
  );
}

type WorkflowStep = {
  env?: Record<string, string>;
  name?: string;
  run?: string;
};

type WorkflowJob = {
  environment?: string | { name?: string };
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
};

const parsedAuthorityWorkflow = parseYaml(readFileSync(authorityWorkflowPath, 'utf8')) as {
  jobs: Record<string, WorkflowJob>;
};

function promotionJob(): WorkflowJob {
  const job = parsedAuthorityWorkflow.jobs?.promote;
  assert.ok(job, 'promotion job should be present');
  return job;
}

function promotionStep(): WorkflowStep {
  const step = promotionJob().steps?.find((candidate) =>
    candidate.name?.includes('Promote R as the explicit production recovery authority')
  );
  assert.ok(step, 'promotion step should be present');
  return step;
}

type FakePromotionMode = 'success' | 'set-fail' | 'mismatch';

function runPromotionScript(mode: FakePromotionMode, token?: string) {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-promotion-'));
  const binDir = join(tempDir, 'bin');
  const callLogPath = join(tempDir, 'gh-calls.log');
  const valuePath = join(tempDir, 'variable-value');
  const tokenPath = join(tempDir, 'gh-token');
  mkdirSync(binDir);
  const fakeGhPath = join(binDir, 'gh');
  writeFileSync(
    fakeGhPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${GH_CALL_LOG:?}"
printf '%s' "\${GH_TOKEN:-}" > "\${GH_TOKEN_LOG:?}"
if [ "\${1:-}" != variable ]; then
  exit 2
fi
case "\${2:-}" in
  set)
    if [ "\${GH_FAKE_MODE:-}" = set-fail ]; then
      exit 41
    fi
    value=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --body ]; then
        value="$2"
        break
      fi
      shift
    done
    if [ "\${GH_FAKE_MODE:-}" = mismatch ]; then
      value=wrong
    fi
    printf '%s\\n' "$value" > "\${GH_VALUE_FILE:?}"
    ;;
  get)
    cat "\${GH_VALUE_FILE:?}"
    ;;
  *)
    exit 2
    ;;
esac
`,
    'utf8'
  );
  chmodSync(fakeGhPath, 0o755);

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GH_CALL_LOG: callLogPath,
    GH_FAKE_MODE: mode,
    GH_TOKEN_LOG: tokenPath,
    GH_VALUE_FILE: valuePath,
    GITHUB_REPOSITORY: 'balejosg/ClassroomPath',
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    PRODUCTION_RECOVERY_SHA: 'a'.repeat(40),
  };
  if (token === undefined) {
    delete environment.PRODUCTION_RECOVERY_VARIABLES_TOKEN;
  } else {
    environment.PRODUCTION_RECOVERY_VARIABLES_TOKEN = token;
  }

  try {
    const result = spawnSync('bash', [promotionScriptPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: environment,
    });
    return {
      calls: existsSync(callLogPath) ? readFileSync(callLogPath, 'utf8') : '',
      result,
      token: existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8') : '',
    };
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function runAuthority(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [authorityScriptPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function createRecoverySourceFixture(
  tempDir: string,
  versions: { contractVersion?: string; sourceVersion?: string } = {}
) {
  const sourceRoot = join(tempDir, 'recovery-source');
  cpSync(join(projectRoot, 'scripts'), join(sourceRoot, 'scripts'), { recursive: true });
  const contractPath = join(sourceRoot, 'scripts/lib/production-recovery-contract.sh');
  let contract = readFileSync(contractPath, 'utf8');
  if (versions.contractVersion) {
    contract = contract.replace(
      /PRODUCTION_RECOVERY_CONTRACT_VERSION=\d+/u,
      `PRODUCTION_RECOVERY_CONTRACT_VERSION=${versions.contractVersion}`
    );
  }
  if (versions.sourceVersion) {
    contract = contract.replace(
      /PRODUCTION_RECOVERY_SOURCE_VERSION=\d+/u,
      `PRODUCTION_RECOVERY_SOURCE_VERSION=${versions.sourceVersion}`
    );
  }
  writeFileSync(contractPath, contract, 'utf8');
  execFileSync('git', ['init', '--quiet', sourceRoot]);
  execFileSync('git', ['-C', sourceRoot, 'config', 'user.email', 'fixture@example.invalid']);
  execFileSync('git', ['-C', sourceRoot, 'config', 'user.name', 'Recovery Fixture']);
  execFileSync('git', ['-C', sourceRoot, 'add', 'scripts']);
  execFileSync('git', ['-C', sourceRoot, 'commit', '--quiet', '-m', 'recovery fixture']);
  const recoverySha = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return { sourceRoot, recoverySha };
}

test('production deploy pins recovery to an external immutable SHA, never the candidate SHA', () => {
  const job = recoveryJob();
  assert.ok(job, 'recovery preparation job should be present');
  assert.match(job, /PRODUCTION_RECOVERY_SHA/u);
  assert.match(job, /vars\.PRODUCTION_RECOVERY_SHA/u);
  assert.match(job, /ref: \$\{\{ vars\.PRODUCTION_RECOVERY_SHA \}\}/u);
  assert.match(job, /[Pp]ro[a-z -]*40|[Ff]ull.*SHA/u);
  assert.match(job, /git rev-parse HEAD/u);
  assert.match(job, /recovery_sha|recovery source/i);
  assert.doesNotMatch(job, /ref: \$\{\{ github\.sha \}\}/u);
  assert.doesNotMatch(job, /source_sha=.*GITHUB_SHA/u);
  assert.match(job, /source_version/u);
  assert.match(job, /contract_version/u);
});

test('a separate manual authority workflow validates, packages, preflights, and promotes R', () => {
  assert.ok(existsSync(authorityWorkflowPath));
  const workflow = readFileSync(authorityWorkflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /recovery_sha/u);
  assert.match(workflow, /validate.*recovery|validate.*SHA/iu);
  assert.match(workflow, /package-production-recovery-bundle\.sh/u);
  assert.match(workflow, /sha256sum/u);
  assert.match(workflow, /preflight/iu);
  assert.match(workflow, /recovery-source\/scripts\/production-recovery-authority\.sh/u);
  assert.doesNotMatch(workflow, /bash scripts\/production-recovery-authority\.sh/u);
  assert.match(workflow, /environment: production-recovery-authority/u);
  assert.doesNotMatch(workflow, /actions: write/u);
  assert.match(workflow, /Variables: write/u);
  assert.match(workflow, /promote-production-recovery-authority\.sh/u);
  assert.match(workflow, /inputs\.promote/u);
  assert.doesNotMatch(
    workflow,
    /github\.sha.*PRODUCTION_RECOVERY_SHA|PRODUCTION_RECOVERY_SHA.*github\.sha/su
  );
});

test('promotion job uses an environment secret with Variables: write and an explicit repository', () => {
  const job = promotionJob();
  const step = promotionStep();
  const environment = job.environment;
  assert.equal(
    typeof environment === 'string' ? environment : environment?.name,
    'production-recovery-authority'
  );
  assert.equal(job.permissions?.actions, undefined);
  assert.equal(job.permissions?.contents, 'read');
  assert.equal(
    step.env?.PRODUCTION_RECOVERY_VARIABLES_TOKEN,
    '${{ secrets.PRODUCTION_RECOVERY_VARIABLES_TOKEN }}'
  );
  assert.match(
    readFileSync(authorityWorkflowPath, 'utf8'),
    /PRODUCTION_RECOVERY_VARIABLES_TOKEN[\s\S]*Variables: write/u
  );
  assert.doesNotMatch(JSON.stringify(job), /github\.token/u);
  assert.match(String(step.run), /promote-production-recovery-authority\.sh/u);
});

test('promotion helper writes and verifies R with the dedicated token and explicit repository', () => {
  const { calls, result, token } = runPromotionScript('success', 'dedicated-variables-token');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PRODUCTION_RECOVERY_PROMOTED=true/u);
  assert.match(
    calls,
    /variable set PRODUCTION_RECOVERY_SHA --repo balejosg\/ClassroomPath --body a{40}/u
  );
  assert.match(calls, /variable get PRODUCTION_RECOVERY_SHA --repo balejosg\/ClassroomPath/u);
  assert.equal(token, 'dedicated-variables-token');
});

test('promotion helper fails closed when variable write fails and never reports R updated', () => {
  const { result } = runPromotionScript('set-fail', 'dedicated-variables-token');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /PRODUCTION_RECOVERY_PROMOTED=false/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PRODUCTION_RECOVERY_PROMOTED=true/u);
});

test('promotion helper fails closed when variable read-back contradicts R', () => {
  const { result } = runPromotionScript('mismatch', 'dedicated-variables-token');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /PRODUCTION_RECOVERY_PROMOTED=false/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PRODUCTION_RECOVERY_PROMOTED=true/u);
});

test('promotion helper rejects a missing Variables: write credential before invoking gh', () => {
  const { calls, result } = runPromotionScript('success');
  assert.notEqual(result.status, 0);
  assert.equal(calls, '');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PRODUCTION_RECOVERY_PROMOTED=true/u);
});

test('the transaction records both candidate identity and independent recovery identity', () => {
  for (const field of [
    'CANDIDATE_SHA',
    'RECOVERY_SOURCE_SHA',
    'RECOVERY_CONTRACT_VERSION',
    'RECOVERY_ARTIFACT_SHA256',
    'RECOVERY_EXECUTOR_SHA256',
  ]) {
    assert.match(transactionHelper, new RegExp(`\\b${field}\\b`, 'u'), field);
  }

  for (const field of [
    'PRODUCTION_RECOVERY_SHA',
    'PRODUCTION_RECOVERY_SOURCE_SHA',
    'PRODUCTION_RECOVERY_CONTRACT_VERSION',
    'PRODUCTION_RECOVERY_ARTIFACT_SHA256',
    'PRODUCTION_RECOVERY_EXECUTOR_SHA256',
  ]) {
    assert.match(artifactHelper, new RegExp(`\\b${field}\\b`, 'u'), field);
  }
});

test('rollback consumes exact transmitted or persisted bytes and never rebuilds recovery', () => {
  assert.match(rollbackScript, /PRODUCTION_RECOVERY_SHA/u);
  assert.match(rollbackScript, /cmp/u);
  assert.match(rollbackScript, /PRODUCTION_RECOVERY_SOURCE_SHA/u);
  assert.doesNotMatch(rollbackScript, /package-production-recovery-bundle\.sh/u);
  assert.doesNotMatch(rollbackScript, /APP_DIR\/scripts\/lib/u);
});

test('authority validation fails closed when R is absent, invalid, or equal to C', () => {
  for (const recoverySha of ['', 'main', 'v1.2.3', 'latest', 'abc123', 'g'.repeat(40)]) {
    const result = spawnSync(
      'bash',
      [
        authorityScriptPath,
        'validate',
        '--recovery-sha',
        recoverySha,
        '--candidate-sha',
        'a'.repeat(40),
        '--source-root',
        projectRoot,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(result.status, 1, `invalid recovery authority should fail: ${recoverySha}`);
  }

  const equalResult = spawnSync(
    'bash',
    [
      authorityScriptPath,
      'validate',
      '--recovery-sha',
      'a'.repeat(40),
      '--candidate-sha',
      'a'.repeat(40),
      '--source-root',
      projectRoot,
    ],
    { cwd: projectRoot, encoding: 'utf8' }
  );
  assert.equal(equalResult.status, 1, 'recovery and candidate SHA equality must fail closed');
});

test('authority validation resolves and packages a distinct local R source exactly', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-authority-'));
  const { sourceRoot, recoverySha } = createRecoverySourceFixture(tempDir);
  const candidateSha = 'a'.repeat(40);
  const bundlePath = join(tempDir, 'production-recovery-bundle.tgz');
  const evidencePath = join(tempDir, 'recovery-authority.env');

  try {
    const validateResult = runAuthority([
      'validate',
      '--recovery-sha',
      recoverySha,
      '--candidate-sha',
      candidateSha,
      '--source-root',
      sourceRoot,
    ]);
    assert.equal(validateResult.status, 0, `${validateResult.stdout}\n${validateResult.stderr}`);

    const packageResult = runAuthority([
      'package',
      '--recovery-sha',
      recoverySha,
      '--candidate-sha',
      candidateSha,
      '--source-root',
      sourceRoot,
      '--output',
      bundlePath,
      '--evidence',
      evidencePath,
    ]);
    assert.equal(packageResult.status, 0, `${packageResult.stdout}\n${packageResult.stderr}`);
    assert.ok(existsSync(bundlePath));
    assert.match(readFileSync(evidencePath, 'utf8'), new RegExp(`SOURCE_SHA=${recoverySha}`, 'u'));
    assert.match(readFileSync(evidencePath, 'utf8'), /ARTIFACT_SHA256=[0-9a-f]{64}/u);
    assert.match(readFileSync(evidencePath, 'utf8'), /EXECUTOR_SHA256=[0-9a-f]{64}/u);
    assert.match(readFileSync(evidencePath, 'utf8'), /CONTRACT_VERSION=1/u);
    assert.match(readFileSync(evidencePath, 'utf8'), /SOURCE_VERSION=1/u);

    const metadata = execFileSync('tar', ['-xOf', bundlePath, 'lib/recovery-authority.env'], {
      encoding: 'utf8',
    });
    assert.match(metadata, new RegExp(`PRODUCTION_RECOVERY_SOURCE_SHA=${recoverySha}`, 'u'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('authority validation rejects an unresolved recovery checkout', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-unresolved-'));
  try {
    const result = runAuthority([
      'validate',
      '--recovery-sha',
      'b'.repeat(40),
      '--source-root',
      tempDir,
    ]);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /HEAD|checkout|source/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('authority packaging rejects an incompatible recovery contract/version', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-incompatible-contract-'));
  const { sourceRoot, recoverySha } = createRecoverySourceFixture(tempDir, {
    contractVersion: '99',
  });
  try {
    const result = runAuthority([
      'package',
      '--recovery-sha',
      recoverySha,
      '--candidate-sha',
      'a'.repeat(40),
      '--source-root',
      sourceRoot,
      '--output',
      join(tempDir, 'recovery.tgz'),
      '--evidence',
      join(tempDir, 'recovery.env'),
    ]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /incompatible/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('authority preflight executes the exact packaged R entrypoint without a host mutation', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-recovery-authority-preflight-'));
  const { sourceRoot, recoverySha } = createRecoverySourceFixture(tempDir);
  const bundlePath = join(tempDir, 'production-recovery-bundle.tgz');
  const evidencePath = join(tempDir, 'recovery-authority.env');

  try {
    const packageResult = runAuthority([
      'package',
      '--recovery-sha',
      recoverySha,
      '--source-root',
      sourceRoot,
      '--output',
      bundlePath,
      '--evidence',
      evidencePath,
    ]);
    assert.equal(packageResult.status, 0, `${packageResult.stdout}\n${packageResult.stderr}`);

    const preflightResult = runAuthority([
      'preflight',
      '--recovery-sha',
      recoverySha,
      '--artifact',
      bundlePath,
      '--evidence',
      evidencePath,
    ]);
    assert.equal(preflightResult.status, 0, `${preflightResult.stdout}\n${preflightResult.stderr}`);
    assert.match(readFileSync(evidencePath, 'utf8'), /PREFLIGHT=passed/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
