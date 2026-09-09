import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'node:test';

import {
  findWorkflowJob,
  findWorkflowStepByName,
  readProjectWorkflow,
  runProjectCommand,
  sanitizeGitEnv,
} from './helpers/ops-contracts.ts';

const RELEASE_ID = '1'.repeat(64);
const OPENPATH_SHA = '2'.repeat(40);
const CONTRACT_SHA = '3'.repeat(64);
const IMAGE = `example.invalid/verifier@sha256:${'4'.repeat(64)}`;
const temporaryRoots: string[] = [];

function makeRoot(label = "release root 'quoted' [fixture]") {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  temporaryRoots.push(root);
  return root;
}

function canonicalRuntime(releaseId = RELEASE_ID) {
  return [
    `RELEASE_ID=${releaseId}`,
    'RC_RUN_ID=123456789',
    'IMAGE_SOURCE=release-candidate',
    `APP_SHA=${'5'.repeat(40)}`,
    `OPENPATH_SHA=${OPENPATH_SHA}`,
    `OPENPATH_CONTRACT_SHA256=${CONTRACT_SHA}`,
    `CLASSROOMPATH_GATEWAY_IMAGE=${IMAGE}`,
    `CLASSROOMPATH_MIGRATIONS_IMAGE=${IMAGE}`,
    `OPENPATH_FIREFOX_ASSETS_IMAGE=${IMAGE}`,
    `OPENPATH_API_IMAGE=${IMAGE}`,
    `CLASSROOMPATH_SPA_IMAGE=${IMAGE}`,
    `CLASSROOMPATH_VERIFIER_IMAGE=${IMAGE}`,
    '',
  ].join('\n');
}

function writeValidState(root: string, pointer = RELEASE_ID, runtime = canonicalRuntime(pointer)) {
  const releaseDir = join(root, 'releases', pointer);
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(join(root, 'current'), `${pointer}\n`, 'utf8');
  writeFileSync(join(releaseDir, 'runtime.env'), runtime, 'utf8');
}

function renderAndRun(root: string) {
  const rendered = runProjectCommand('bash', [
    'scripts/lib/smoke-release-state-reader.sh',
    'render',
    root,
  ]);
  assert.equal(rendered.status, 0, rendered.stderr);
  return spawnSync('bash', ['-c', rendered.stdout], {
    encoding: 'utf8',
    env: sanitizeGitEnv(),
  });
}

function runProductionWorkflowReader(deployRoot: string) {
  const workflow = readProjectWorkflow('.github/workflows/smoke-tests.yml');
  const step = findWorkflowStepByName(
    findWorkflowJob(workflow, 'resolve-production-release'),
    'Read exact current production Release Bundle state'
  );
  const workingRoot = makeRoot('workflow runner');
  const fakeBin = join(workingRoot, 'bin');
  const outputFile = join(workingRoot, 'github-output');
  mkdirSync(fakeBin);
  symlinkSync(join(process.cwd(), 'scripts'), join(workingRoot, 'scripts'));
  writeFileSync(
    join(fakeBin, 'ssh'),
    ['#!/usr/bin/env bash', 'remote_command="${!#}"', 'bash -c "$remote_command"', ''].join('\n'),
    { mode: 0o700 }
  );
  writeFileSync(outputFile, '', 'utf8');

  const script = String(step.run ?? '').replaceAll(/\$\{\{[^}]+\}\}/g, 'fixture');
  const result = spawnSync('bash', ['-c', script], {
    cwd: workingRoot,
    encoding: 'utf8',
    env: sanitizeGitEnv({
      CLASSROOMPATH_DEPLOY_ROOT: deployRoot,
      GITHUB_OUTPUT: outputFile,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    }),
  });
  return { result, outputs: readFileSync(outputFile, 'utf8') };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Smoke Tests exact deployed release reader', () => {
  test('both workflow readers invoke the shared real command generator', () => {
    const workflow = readProjectWorkflow('.github/workflows/smoke-tests.yml');
    const cases = [
      ['resolve-staging-release', 'Read exact current staging Release Bundle state'],
      ['resolve-production-release', 'Read exact current production Release Bundle state'],
    ] as const;

    for (const [jobName, stepName] of cases) {
      const step = findWorkflowStepByName(findWorkflowJob(workflow, jobName), stepName);
      const script = String(step.run ?? '');
      assert.match(script, /smoke-release-state-reader\.sh\s+\\?\s*render/);
      assert.doesNotMatch(script, /\\\$state_root/);
      if (jobName === 'resolve-staging-release') {
        assert.match(script, /render\s+\\?\s*\/srv\/classroompath\/release-state/);
      } else {
        assert.match(script, /render "\$state_root"/);
      }
    }
  });

  test('the real generated production command reads a canonical fixture with a special root', () => {
    const deployRoot = makeRoot();
    const stateRoot = join(deployRoot, 'release-state');
    writeValidState(stateRoot);

    const { result, outputs } = runProductionWorkflowReader(deployRoot);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '');
    assert.match(outputs, new RegExp(`^release_id=${RELEASE_ID}$`, 'm'));
    assert.match(outputs, new RegExp(`^openpath_sha=${OPENPATH_SHA}$`, 'm'));
  });

  test('rejects invalid pointers before a runtime path can be read', () => {
    const invalidPointers = [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'g',
      'A'.repeat(64),
      ' ',
      '../fixture',
      `${RELEASE_ID}\n${'2'.repeat(64)}`,
      `${RELEASE_ID}\n`,
    ];

    for (const pointer of invalidPointers) {
      const root = makeRoot('invalid pointer');
      writeFileSync(join(root, 'current'), `${pointer}\n`, 'utf8');
      const decoy = join(root, 'releases', pointer, 'runtime.env');
      if (!pointer.includes('/') && !pointer.includes('\n') && pointer.length > 0) {
        mkdirSync(join(root, 'releases', pointer), { recursive: true });
        writeFileSync(decoy, canonicalRuntime(RELEASE_ID), 'utf8');
      }

      const result = renderAndRun(root);
      assert.equal(result.status, 42, JSON.stringify({ pointer, stderr: result.stderr }));
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'SMOKE_RELEASE_STATE_ERROR=pointer-invalid\n');
    }
  });

  test('emits stable diagnostics for each reader failure without data on stdout', () => {
    const cases: Array<[string, number, (root: string) => void]> = [
      ['current-missing-or-empty', 40, () => {}],
      [
        'current-unreadable',
        41,
        (root) => {
          mkdirSync(join(root, 'current'));
        },
      ],
      [
        'runtime-state-missing',
        43,
        (root) => {
          writeFileSync(join(root, 'current'), `${RELEASE_ID}\n`, 'utf8');
        },
      ],
      [
        'runtime-state-unreadable',
        44,
        (root) => {
          writeFileSync(join(root, 'current'), `${RELEASE_ID}\n`, 'utf8');
          mkdirSync(join(root, 'releases', RELEASE_ID, 'runtime.env'), { recursive: true });
        },
      ],
    ];

    for (const [marker, exitCode, arrange] of cases) {
      const root = makeRoot(marker);
      arrange(root);
      const result = renderAndRun(root);
      assert.equal(result.status, exitCode, marker);
      assert.equal(result.stdout, '', marker);
      assert.equal(result.stderr, `SMOKE_RELEASE_STATE_ERROR=${marker}\n`);
      assert.doesNotMatch(result.stderr, new RegExp(root));
    }
  });

  test('canonical parser still rejects pointer and runtime identity mismatch', () => {
    const root = makeRoot('identity mismatch');
    writeValidState(root, RELEASE_ID, canonicalRuntime('2'.repeat(64)));

    const readResult = renderAndRun(root);
    assert.equal(readResult.status, 0, readResult.stderr);

    const stateFile = join(root, 'captured.env');
    writeFileSync(stateFile, readResult.stdout, 'utf8');
    const parsed = runProjectCommand('node', [
      'scripts/resolve-deployed-release-state.mjs',
      '--state-file',
      stateFile,
      '--pointer-release-id',
      RELEASE_ID,
    ]);
    assert.equal(parsed.status, 1);
    assert.match(parsed.stderr, /pointer releaseId does not match runtime RELEASE_ID/);
  });
});
