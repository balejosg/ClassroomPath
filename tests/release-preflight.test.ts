import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  defaultRunCommand,
  resolveNextPatchTag,
  runReleasePreflight,
} from '../scripts/lib/release-preflight.mjs';

const CLASSROOM_SHA = '1111111111111111111111111111111111111111';
const OPENPATH_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const healthyStatus = {
  classroompath: {
    headSha: CLASSROOM_SHA,
    originMainSha: CLASSROOM_SHA,
  },
  openpath: {
    submoduleSha: OPENPATH_SHA,
    requiredChecks: [
      { name: 'CI Success', status: 'success' },
      {
        name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
        status: 'success',
      },
    ],
  },
  releaseCandidate: {
    latestRun: { databaseId: 123456, conclusion: 'success' },
    manifestStatus: 'read',
    manifest: {
      app_sha: CLASSROOM_SHA,
      openpath_api_image: 'ghcr.io/balejosg/classroompath-openpath-api@sha256:4',
    },
  },
  staging: {
    currentImages: {
      APP_SHA: CLASSROOM_SHA,
      IMAGE_SOURCE: 'release-candidate',
    },
    verification: {
      STAGING_VERIFIED_APP_SHA: CLASSROOM_SHA,
      STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
      STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
      STAGING_SMOKE_RESULT: 'success',
      STAGING_RELEASE_GATE_RESULT: 'success',
      STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
      STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: 'success',
    },
  },
  production: {
    lastDeploy: { databaseId: 987654, conclusion: 'success' },
    currentImages: { APP_SHA: 'old-sha' },
  },
  promotionBlockers: [],
  productionBlockers: [],
};

function createHarness(overrides: Partial<Record<string, string>> = {}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand = (command: string, args: string[]) => {
    calls.push({ command, args });
    const line = [command, ...args].join(' ');

    if (line === 'git status --porcelain') return overrides.gitStatus ?? '';
    if (line === 'git rev-parse HEAD') return overrides.head ?? CLASSROOM_SHA;
    if (line === 'git rev-parse origin/main') return overrides.originMain ?? CLASSROOM_SHA;
    if (line === 'git tag --list v1.2.3') return overrides.existingTag ?? '';
    if (line === 'git tag --list v1.2.302') return overrides.existingTag ?? '';
    if (line === 'git ls-remote --tags --refs origin v*') {
      return (
        overrides.remoteTags ??
        [
          'aaa\trefs/tags/v1.2.299',
          'bbb\trefs/tags/v1.2.301',
          'ccc\trefs/tags/not-semver',
          '',
        ].join('\n')
      );
    }

    throw new Error(`Unexpected command: ${line}`);
  };

  return { calls, runCommand };
}

test('release preflight passes with read-only checks when promotion evidence is complete', async () => {
  const harness = createHarness();

  const result = await runReleasePreflight({
    status: healthyStatus,
    nextTag: 'v1.2.3',
    env: {
      STAGING_HOST: 'staging.internal',
      DEPLOY_HOST: 'prod.internal',
      PROXMOX_HOST: 'proxmox.internal',
    },
    runCommand: harness.runCommand,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checks.cleanCheckout.ok, true);
  assert.equal(result.checks.releaseCandidate.ok, true);
  assert.equal(
    harness.calls.some((call) =>
      /(git push|git tag v|gh workflow run|npm run deploy)/.test(
        [call.command, ...call.args].join(' ')
      )
    ),
    false
  );
});

test('release preflight fails early on operational placeholder targets', async () => {
  const harness = createHarness();

  const result = await runReleasePreflight({
    status: healthyStatus,
    nextTag: 'v1.2.3',
    env: {
      STAGING_HOST: 'staging-host.example.invalid',
      DEPLOY_HOST: 'classroompath.example.invalid',
      PROXMOX_HOST: 'proxmox-host.example.invalid',
    },
    runCommand: harness.runCommand,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('operational-target-placeholder'));
  assert.match(result.checks.operationalTargets.message, /STAGING_HOST/);
  assert.match(result.checks.operationalTargets.message, /DEPLOY_HOST/);
  assert.match(result.checks.operationalTargets.message, /PROXMOX_HOST/);
});

test('release preflight accepts a real Proxmox alias without PROXMOX_HOST', async () => {
  const harness = createHarness();

  const result = await runReleasePreflight({
    status: healthyStatus,
    nextTag: 'v1.2.3',
    env: {
      STAGING_HOST: 'staging.internal',
      DEPLOY_HOST: 'prod.internal',
      PROXMOX_SSH_ALIAS: 'whitelist-proxmox',
    },
    runCommand: harness.runCommand,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.operationalTargets, {
    ok: true,
    message: 'operational targets are real values',
  });
});

test('release preflight infers next tag from remote tags when no tag is provided', async () => {
  const harness = createHarness();

  const result = await runReleasePreflight({
    status: healthyStatus,
    env: {
      STAGING_HOST: 'staging.internal',
      DEPLOY_HOST: 'prod.internal',
      PROXMOX_HOST: 'proxmox.internal',
    },
    runCommand: harness.runCommand,
  });

  assert.equal(result.ok, true);
  assert.equal(result.nextTag, 'v1.2.302');
  assert.deepEqual(resolveNextPatchTag('aaa\trefs/tags/v1.9.4\nbbb\trefs/tags/v2.0.0\n'), 'v2.0.1');
});

test('release preflight default runner preserves binary command output when requested', () => {
  const output = defaultRunCommand(
    process.execPath,
    ['-e', 'process.stdout.write(Buffer.from([0, 255, 1, 254]))'],
    { encoding: 'buffer' }
  );

  assert.ok(Buffer.isBuffer(output));
  assert.deepEqual([...output], [0, 255, 1, 254]);
});

test('release preflight blocks dirty checkout, stale HEAD, missing evidence, and existing tag', async () => {
  const harness = createHarness({
    gitStatus: ' M scripts/release-status.mjs\n',
    originMain: '2222222222222222222222222222222222222222',
    existingTag: 'v1.2.3\n',
  });

  const result = await runReleasePreflight({
    status: {
      ...healthyStatus,
      promotionBlockers: ['windows-prepromotion-evidence-missing'],
      staging: {
        ...healthyStatus.staging,
        verification: {
          ...healthyStatus.staging.verification,
          STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: '',
        },
      },
    },
    nextTag: 'v1.2.3',
    env: {
      STAGING_HOST: 'staging.internal',
      DEPLOY_HOST: 'prod.internal',
      PROXMOX_HOST: 'proxmox.internal',
    },
    runCommand: harness.runCommand,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('checkout-not-clean'));
  assert.ok(result.blockers.includes('classroompath-head-not-origin-main'));
  assert.ok(result.blockers.includes('windows-prepromotion-evidence-missing'));
  assert.ok(result.blockers.includes('next-tag-already-exists'));
});

test('package.json exposes release:preflight script', () => {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.equal(packageJson.scripts['release:preflight'], 'node scripts/release-preflight.mjs');
});
