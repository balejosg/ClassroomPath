import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildReleaseStatus,
  buildReleaseStatusJson,
  parseReleaseStatusArgs,
  renderReleaseStatusText,
} from '../scripts/release-status.mjs';
import {
  collectReleaseStatusEvidence,
  detectOperationalTargetPlaceholders,
} from '../scripts/lib/release-status-collector.mjs';
import {
  deriveReleaseBlockerGroups,
  deriveReleaseBlockers,
} from '../scripts/lib/release-status-evaluator.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const cliPath = resolve(projectRoot, 'scripts/release-status.mjs');

// A project root that never exists on disk, so tests that don't exercise the
// `.env.local` merge stay hermetic even when the real repo checkout has an
// operator `.env.local` (readEnvFileIfPresent no-ops when the file is absent).
// Mirrors NO_ENV_LOCAL_PROJECT_ROOT in tests/release-preflight.test.ts.
const NO_ENV_LOCAL_PROJECT_ROOT = resolve(tmpdir(), 'release-status-test-no-env-local');

const CLASSROOM_SHA = '1111111111111111111111111111111111111111';
const ORIGIN_SHA = '2222222222222222222222222222222222222222';
const OPENPATH_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const manifestText = [
  'repository=balejosg/ClassroomPath',
  'run_id=123456',
  `app_sha=${CLASSROOM_SHA}`,
  'gateway_image=ghcr.io/balejosg/classroompath-gateway@sha256:1',
  'migrations_image=ghcr.io/balejosg/classroompath-migrations@sha256:2',
  'openpath_firefox_assets_image=ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:3',
  'openpath_api_image=ghcr.io/balejosg/classroompath-openpath-api@sha256:4',
  'openpath_version=4.1.19',
  'linux_agent_version=4.1.19',
  'linux_agent_apt_suite=unstable',
  'spa_image=ghcr.io/balejosg/classroompath-spa@sha256:5',
  'verifier_image=ghcr.io/balejosg/classroompath-release-verifier@sha256:6',
  '',
].join('\n');

function realOperationalTargetEnv() {
  return {
    STAGING_HOST: 'staging.internal',
    DEPLOY_HOST: 'production.internal',
    PROXMOX_HOST: 'proxmox.internal',
    CLASSROOMPATH_DEPLOY_ROOT: '/private/classroompath',
  };
}

function createCommandHarness(
  options: {
    originSha?: string;
    openpathCheckStatus?: string;
    openpathChangedFiles?: string[];
    includeOlderFailedE2eCheck?: boolean;
  } = {}
) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const originSha = options.originSha ?? ORIGIN_SHA;
  const openpathCheckStatus = options.openpathCheckStatus ?? 'success';
  const openpathChangedFiles = options.openpathChangedFiles ?? [];

  const runCommand = (command: string, args: string[]) => {
    calls.push({ command, args });
    const commandLine = [command, ...args].join(' ');

    if (commandLine === 'git rev-parse HEAD') {
      return CLASSROOM_SHA;
    }

    if (commandLine === 'git rev-parse origin/main') {
      return originSha;
    }

    if (commandLine === 'git rev-parse HEAD:upstream/openpath') {
      return OPENPATH_SHA;
    }

    if (commandLine === 'git tag --sort=-creatordate') {
      return ['v1.2.301', 'v1.2.300', ''].join('\n');
    }

    if (commandLine === 'git rev-parse v1.2.301:upstream/openpath') {
      return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    }

    if (
      commandLine ===
      `git -C upstream/openpath diff --name-only bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ${OPENPATH_SHA}`
    ) {
      return [...openpathChangedFiles, ''].join('\n');
    }

    if (commandLine === 'git remote get-url origin') {
      return 'git@github.com:BalejosG/ClassroomPath.git';
    }

    if (commandLine === 'git ls-remote --tags --refs origin v*') {
      return [
        'aaa\trefs/tags/v1.2.299',
        'bbb\trefs/tags/v1.2.301',
        'ccc\trefs/tags/not-semver',
        '',
      ].join('\n');
    }

    if (command === 'gh' && args[0] === 'api' && args[1].includes('/commits/')) {
      const checkRuns = [
        { name: 'CI Success', status: 'completed', conclusion: openpathCheckStatus },
        {
          name: 'E2E Summary',
          status: 'completed',
          conclusion: openpathCheckStatus,
          completed_at: '2026-05-21T05:54:11Z',
        },
        {
          name: 'Installer Contracts Success',
          status: 'completed',
          conclusion: openpathCheckStatus,
        },
        {
          name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
          status: 'completed',
          conclusion: openpathCheckStatus,
        },
      ];
      if (options.includeOlderFailedE2eCheck) {
        checkRuns.push({
          name: 'E2E Summary',
          status: 'completed',
          conclusion: 'failure',
          completed_at: '2026-05-21T05:45:12Z',
        });
      }
      return JSON.stringify({
        check_runs: checkRuns,
      });
    }

    if (command === 'gh' && args[0] === 'run' && args[1] === 'list') {
      if (args.includes('release-candidate-images.yml')) {
        return JSON.stringify([
          {
            databaseId: 123456,
            headSha: CLASSROOM_SHA,
            event: 'workflow_dispatch',
            status: 'completed',
            conclusion: 'success',
            updatedAt: '2026-05-05T08:00:00Z',
            url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123456',
          },
        ]);
      }

      if (args.includes('deploy.yml')) {
        return JSON.stringify([
          {
            databaseId: 987654,
            headSha: CLASSROOM_SHA,
            event: 'push',
            status: 'completed',
            conclusion: 'success',
            updatedAt: '2026-05-05T09:00:00Z',
            url: 'https://github.com/balejosg/ClassroomPath/actions/runs/987654',
          },
        ]);
      }
    }

    if (
      command === 'gh' &&
      args[0] === 'api' &&
      args[1].includes(`/actions/runs/123456/artifacts`)
    ) {
      return JSON.stringify({
        artifacts: [{ id: 789, name: `release-candidate-images-${CLASSROOM_SHA}`, expired: false }],
      });
    }

    if (command === 'gh' && args[0] === 'api' && args[1].includes('/actions/artifacts/789/zip')) {
      return manifestText;
    }

    if (command === 'ssh' && args.at(-1)?.includes('staging-verification.env')) {
      return [
        `STAGING_VERIFIED_APP_SHA=${CLASSROOM_SHA}`,
        `STAGING_VERIFIED_OPENPATH_SHA=${OPENPATH_SHA}`,
        'STAGING_VERIFIED_IMAGE_SOURCE=release-candidate',
        'STAGING_SMOKE_RESULT=success',
        'STAGING_RELEASE_GATE_RESULT=success',
        'STAGING_PREPROMOTION_REHEARSAL_RESULT=success',
        'STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=success',
        '',
      ].join('\n');
    }

    if (command === 'ssh' && args.at(-1)?.includes('current-images.env')) {
      return [`APP_SHA=${CLASSROOM_SHA}`, 'IMAGE_SOURCE=release-candidate', ''].join('\n');
    }

    throw new Error(`Unexpected command: ${commandLine}`);
  };

  return { calls, runCommand };
}

test('parses the read-only release status CLI options', () => {
  assert.deepEqual(
    parseReleaseStatusArgs(['--sha', CLASSROOM_SHA, '--openpath-sha', OPENPATH_SHA]),
    {
      sha: CLASSROOM_SHA,
      openpathSha: OPENPATH_SHA,
      json: false,
    }
  );

  assert.equal(parseReleaseStatusArgs(['--json']).json, true);
});

test('builds a local promotion status summary from read-only command sources', async () => {
  const harness = createCommandHarness();
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  assert.equal(status.classroomPath.headSha, CLASSROOM_SHA);
  assert.equal(status.classroomPath.originMainSha, ORIGIN_SHA);
  assert.equal(status.openPath.submoduleSha, OPENPATH_SHA);
  assert.equal(status.releaseCandidate.manifest?.linux_agent_apt_suite, 'unstable');
  assert.equal(
    status.openPath.requiredChecks.every((check) => check.status === 'success'),
    true
  );
  assert.equal(status.stagingVerification.state?.STAGING_SMOKE_RESULT, 'success');
  assert.equal(status.productionDeploy.latestRun?.databaseId, 987654);

  const commandLines = harness.calls.map((call) => [call.command, ...call.args].join(' '));
  assert.ok(commandLines.some((line) => line.startsWith('git rev-parse HEAD')));
  assert.ok(commandLines.some((line) => line.startsWith('gh run list')));
  assert.ok(commandLines.some((line) => line.startsWith('ssh ')));
  assert.ok(
    commandLines.some((line) =>
      line.includes('/srv/classroompath/release-state/current-images.env')
    ),
    'release status should keep staging release-state reads on the staging deploy root'
  );
  assert.ok(
    commandLines.some((line) =>
      line.includes('/private/classroompath/release-state/current-images.env')
    ),
    'release status should read production release-state from the production deploy root'
  );
  assert.equal(
    commandLines.some((line) =>
      /(git push|git tag (?!--)|gh workflow run|gh run rerun|npm run deploy|promote:production)/.test(
        line
      )
    ),
    false
  );
});

test('collector owns read-only release status command-backed evidence', async () => {
  const harness = createCommandHarness({ originSha: CLASSROOM_SHA });
  const status = await collectReleaseStatusEvidence({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
      ...realOperationalTargetEnv(),
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  assert.equal(status.classroomPath.headSha, CLASSROOM_SHA);
  assert.equal(status.releaseCandidate.manifest?.app_sha, CLASSROOM_SHA);
  assert.equal(status.productionDeploy.latestRun?.databaseId, 987654);
  assert.equal(status.release.nextTag, 'v1.2.302');
  assert.deepEqual(status.operationalTargets.placeholders, []);

  const commandLines = harness.calls.map((call) => [call.command, ...call.args].join(' '));
  assert.ok(commandLines.some((line) => line.startsWith('git rev-parse HEAD')));
  assert.ok(commandLines.some((line) => line.startsWith('gh run list')));
  assert.ok(commandLines.some((line) => line.startsWith('ssh ')));
  assert.equal(
    commandLines.some((line) =>
      /(git push|git tag (?!--)|gh workflow run|gh run rerun|npm run deploy|promote:production)/.test(
        line
      )
    ),
    false
  );
});

test('renders human output by default', async () => {
  const harness = createCommandHarness();
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA, '--openpath-sha', OPENPATH_SHA],
    env: process.env,
    runCommand: harness.runCommand,
  });

  const text = renderReleaseStatusText(status);

  assert.match(text, /ClassroomPath/);
  assert.match(text, /Release candidate manifest/);
  assert.match(text, /Prerelease APT pin: unstable/);
  assert.match(text, /OpenPath required checks/);
  assert.match(text, /Last production deploy/);
  assert.match(text, /Promotion blockers/);
  assert.match(text, /Production blockers/);
});

test('CLI emits JSON when requested', () => {
  const binDir = createReleaseStatusFakeBin();
  const result = spawnSync(process.execPath, [cliPath, '--json', '--sha', CLASSROOM_SHA], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_TEST_MANIFEST: manifestText,
      ...realOperationalTargetEnv(),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.classroomPath.headSha, CLASSROOM_SHA);
  assert.equal(payload.classroompath.head, CLASSROOM_SHA);
  assert.equal(payload.openpath.submoduleSha, OPENPATH_SHA);
  assert.equal(payload.releaseCandidate.manifest.linux_agent_apt_suite, 'unstable');
  assert.deepEqual(payload.promotionBlockers, []);
  assert.deepEqual(payload.productionBlockers, []);
  assert.deepEqual(payload.blockers, []);
  assert.equal(result.stderr, '');
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});

test('builds normalized JSON sections for release automation', async () => {
  const harness = createCommandHarness({ originSha: CLASSROOM_SHA });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  const payload = buildReleaseStatusJson(status);

  assert.equal(payload.classroompath.head, CLASSROOM_SHA);
  assert.equal(payload.classroompath.originMain, CLASSROOM_SHA);
  assert.equal(payload.openpath.submoduleSha, OPENPATH_SHA);
  assert.equal(payload.releaseCandidate.runId, 123456);
  assert.equal(payload.releaseCandidate.status, 'success');
  assert.equal(payload.staging.currentImages.APP_SHA, CLASSROOM_SHA);
  assert.equal(payload.staging.verification.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT, 'success');
  assert.equal(payload.production.lastDeploy?.runId, 987654);
  assert.equal(payload.production.currentImages.APP_SHA, CLASSROOM_SHA);
  assert.equal(payload.release.nextTag, 'v1.2.302');
  assert.deepEqual(payload.promotionBlockers, []);
  assert.deepEqual(payload.productionBlockers, []);
  assert.deepEqual(payload.blockers, []);
});

test('release status uses promotion-ready OpenPath risk checks for low-risk diffs', async () => {
  const harness = createCommandHarness({
    originSha: CLASSROOM_SHA,
    openpathChangedFiles: ['docs/INDEX.md'],
  });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  assert.deepEqual(
    status.openPath.requiredChecks.map((check) => check.name),
    ['CI Success']
  );
  assert.deepEqual(status.blockers, []);
});

test('release status uses promotion-ready OpenPath risk checks for endpoint diffs', async () => {
  const harness = createCommandHarness({
    originSha: CLASSROOM_SHA,
    openpathChangedFiles: ['windows/OpenPath.psm1', 'linux/lib/firefox-policy.sh'],
  });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  assert.deepEqual(
    status.openPath.requiredChecks.map((check) => check.name),
    ['CI Success', 'E2E Summary', 'Installer Contracts Success']
  );
  assert.deepEqual(status.blockers, []);
});

test('release status uses the latest OpenPath check-run when a retry replaces a failure', async () => {
  const harness = createCommandHarness({
    originSha: CLASSROOM_SHA,
    openpathChangedFiles: ['windows/OpenPath.psm1', 'linux/lib/firefox-policy.sh'],
    includeOlderFailedE2eCheck: true,
  });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  assert.equal(
    status.openPath.requiredChecks.find((check) => check.name === 'E2E Summary')?.status,
    'success'
  );
  assert.deepEqual(status.blockers, []);
});

test('release status uses promotion-ready OpenPath risk checks for release infrastructure diffs', async () => {
  const harness = createCommandHarness({
    originSha: CLASSROOM_SHA,
    openpathChangedFiles: ['.github/workflows/release.yml'],
  });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand: harness.runCommand,
  });

  assert.deepEqual(
    status.openPath.requiredChecks.map((check) => check.name),
    ['CI Success', 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)']
  );
  assert.deepEqual(status.blockers, []);
});

test('derives stable release blockers from release status evidence', async () => {
  const harness = createCommandHarness({ openpathCheckStatus: 'failure' });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand(command, args) {
      if (command === 'gh' && args[0] === 'run' && args[1] === 'list') {
        if (args.includes('release-candidate-images.yml')) {
          return '[]';
        }

        if (args.includes('deploy.yml')) {
          return JSON.stringify([
            {
              databaseId: 987654,
              headSha: CLASSROOM_SHA,
              event: 'push',
              status: 'completed',
              conclusion: 'failure',
              updatedAt: '2026-05-05T09:00:00Z',
              url: 'https://github.com/balejosg/ClassroomPath/actions/runs/987654',
            },
          ]);
        }
      }

      if (command === 'ssh' && args.at(-1)?.includes('staging-verification.env')) {
        return [
          'STAGING_VERIFIED_APP_SHA=old-sha',
          `STAGING_VERIFIED_OPENPATH_SHA=${OPENPATH_SHA}`,
          'STAGING_VERIFIED_IMAGE_SOURCE=source-build',
          'STAGING_SMOKE_RESULT=failed',
          'STAGING_RELEASE_GATE_RESULT=failed',
          '',
        ].join('\n');
      }

      return harness.runCommand(command, args);
    },
  });

  assert.deepEqual(deriveReleaseBlockers(status), [
    'classroompath-head-behind-origin',
    'openpath-required-checks-not-green',
    'release-candidate-missing',
    'staging-not-promotion-eligible',
    'windows-prepromotion-evidence-missing',
    'production-deploy-not-success',
  ]);
  assert.deepEqual(deriveReleaseBlockerGroups(status), {
    promotionBlockers: [
      'classroompath-head-behind-origin',
      'openpath-required-checks-not-green',
      'release-candidate-missing',
      'staging-not-promotion-eligible',
      'windows-prepromotion-evidence-missing',
    ],
    productionBlockers: ['production-deploy-not-success'],
  });
});

test('keeps stale staging as promotion-only blocker when production already runs target SHA', async () => {
  const harness = createCommandHarness({ originSha: CLASSROOM_SHA });
  const status = await buildReleaseStatus({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      ...realOperationalTargetEnv(),
    },
    runCommand(command, args) {
      if (command === 'ssh' && args.at(-1)?.includes('staging-verification.env')) {
        return [
          'STAGING_VERIFIED_APP_SHA=old-sha',
          `STAGING_VERIFIED_OPENPATH_SHA=${OPENPATH_SHA}`,
          'STAGING_VERIFIED_IMAGE_SOURCE=source-build',
          'STAGING_SMOKE_RESULT=failed',
          'STAGING_RELEASE_GATE_RESULT=failed',
          '',
        ].join('\n');
      }

      return harness.runCommand(command, args);
    },
  });

  const payload = buildReleaseStatusJson(status);

  assert.ok(payload.promotionBlockers.includes('staging-not-promotion-eligible'));
  assert.ok(payload.promotionBlockers.includes('windows-prepromotion-evidence-missing'));
  assert.deepEqual(payload.productionBlockers, []);
  assert.deepEqual(payload.blockers, []);
});

test('detects operational placeholders in status JSON for preflight consumers', async () => {
  const harness = createCommandHarness({ originSha: CLASSROOM_SHA });
  // Uses collectReleaseStatusEvidence directly (rather than buildReleaseStatus) so a
  // projectRootOverride pointing at a non-existent directory can be passed, keeping this
  // test hermetic to the operator's real `.env.local` (e.g. a PROXMOX_SSH_ALIAS entry
  // there would otherwise silently clear the PROXMOX_HOST placeholder below).
  // buildReleaseStatusJson derives promotionBlockers/productionBlockers itself when they
  // aren't already present on the status, so this is equivalent to buildReleaseStatus here.
  const status = await collectReleaseStatusEvidence({
    argv: ['--sha', CLASSROOM_SHA],
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_STAGING_SSH_KEY: '/tmp/classroompath_staging_key',
      RELEASE_STATUS_PRODUCTION_SSH_KEY: '/tmp/classroompath_production_key',
      STAGING_HOST: 'staging-host.example.invalid',
      DEPLOY_HOST: 'classroompath.example.invalid',
      PROXMOX_HOST: 'proxmox-host.example.invalid',
    },
    runCommand: harness.runCommand,
    projectRootOverride: NO_ENV_LOCAL_PROJECT_ROOT,
  });

  const payload = buildReleaseStatusJson(status);

  assert.deepEqual(payload.operationalTargets.placeholders, [
    { name: 'STAGING_HOST', value: 'staging-host.example.invalid' },
    { name: 'DEPLOY_HOST', value: 'classroompath.example.invalid' },
    { name: 'PROXMOX_HOST', value: 'proxmox-host.example.invalid' },
  ]);
  assert.ok(payload.promotionBlockers.includes('operational-target-placeholder'));
});

test('classifies example.invalid operational targets as placeholders', () => {
  assert.deepEqual(
    detectOperationalTargetPlaceholders({
      STAGING_HOST: 'staging-host.example.invalid',
      DEPLOY_HOST: 'prod.example.invalid',
      PROXMOX_HOST: 'proxmox-host.example.invalid',
    }),
    [
      { name: 'STAGING_HOST', value: 'staging-host.example.invalid' },
      { name: 'DEPLOY_HOST', value: 'prod.example.invalid' },
      { name: 'PROXMOX_HOST', value: 'proxmox-host.example.invalid' },
    ]
  );
});

test('does not require PROXMOX_HOST when a real Proxmox alias is configured', () => {
  assert.deepEqual(
    detectOperationalTargetPlaceholders({
      STAGING_HOST: 'staging.internal',
      DEPLOY_HOST: 'prod.internal',
      PROXMOX_SSH_ALIAS: 'proxmox-ci-alias',
    }),
    []
  );
  assert.deepEqual(
    detectOperationalTargetPlaceholders({
      STAGING_HOST: 'staging.internal',
      DEPLOY_HOST: 'prod.internal',
      WINDOWS_RUNNER_PROXMOX_HOST: 'windows-proxmox',
    }),
    []
  );
});

function createReleaseStatusFakeBin() {
  const binDir = mkdtempSync(resolve(tmpdir(), 'release-status-bin-'));
  const scripts: Record<string, string> = {
    git: `#!/usr/bin/env node
const args = process.argv.slice(2);
const line = args.join(' ');
if (line === 'rev-parse HEAD') console.log('${CLASSROOM_SHA}');
else if (line === 'rev-parse origin/main') console.log('${CLASSROOM_SHA}');
else if (line === 'rev-parse HEAD:upstream/openpath') console.log('${OPENPATH_SHA}');
else if (line === 'tag --sort=-creatordate') console.log('v1.2.301');
else if (line === 'rev-parse v1.2.301:upstream/openpath') console.log('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
else if (line === 'ls-remote --tags --refs origin v*') console.log('aaa\\trefs/tags/v1.2.301');
else if (line === '-C upstream/openpath diff --name-only bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ${OPENPATH_SHA}') console.log('docs/INDEX.md');
else if (line === 'remote get-url origin') console.log('git@github.com:BalejosG/ClassroomPath.git');
else { console.error('Unexpected git ' + line); process.exit(1); }
`,
    gh: `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'api' && args[1].includes('/commits/')) {
  console.log(JSON.stringify({ check_runs: [
    { name: 'CI Success', status: 'completed', conclusion: 'success' },
    { name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)', status: 'completed', conclusion: 'success' }
  ] }));
} else if (args[0] === 'run' && args[1] === 'list' && args.includes('release-candidate-images.yml')) {
  console.log(JSON.stringify([{ databaseId: 123456, headSha: '${CLASSROOM_SHA}', event: 'push', status: 'completed', conclusion: 'success', updatedAt: '2026-05-05T08:00:00Z', url: 'https://github.com/balejosg/ClassroomPath/actions/runs/123456' }]));
} else if (args[0] === 'run' && args[1] === 'list' && args.includes('deploy.yml')) {
  console.log(JSON.stringify([{ databaseId: 987654, headSha: '${CLASSROOM_SHA}', event: 'push', status: 'completed', conclusion: 'success', updatedAt: '2026-05-05T09:00:00Z', url: 'https://github.com/balejosg/ClassroomPath/actions/runs/987654' }]));
} else {
  console.error('Unexpected gh ' + args.join(' '));
  process.exit(1);
}
`,
    ssh: `#!/usr/bin/env node
const command = process.argv.at(-1) || '';
if (command.includes('staging-verification.env')) {
  console.log([
    'STAGING_VERIFIED_APP_SHA=${CLASSROOM_SHA}',
    'STAGING_VERIFIED_OPENPATH_SHA=${OPENPATH_SHA}',
    'STAGING_VERIFIED_IMAGE_SOURCE=release-candidate',
    'STAGING_SMOKE_RESULT=success',
    'STAGING_RELEASE_GATE_RESULT=success',
    'STAGING_PREPROMOTION_REHEARSAL_RESULT=success',
    'STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT=success'
  ].join('\\n'));
} else if (command.includes('current-images.env')) {
  console.log(['APP_SHA=${CLASSROOM_SHA}', 'IMAGE_SOURCE=release-candidate'].join('\\n'));
} else {
  console.error('Unexpected ssh ' + command);
  process.exit(1);
}
`,
  };

  for (const [name, content] of Object.entries(scripts)) {
    const path = resolve(binDir, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
  }

  return binDir;
}
