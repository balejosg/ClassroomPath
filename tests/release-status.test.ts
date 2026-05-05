import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildReleaseStatus,
  parseReleaseStatusArgs,
  renderReleaseStatusText,
} from '../scripts/release-status.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const cliPath = resolve(projectRoot, 'scripts/release-status.mjs');

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

function createCommandHarness() {
  const calls: Array<{ command: string; args: string[] }> = [];

  const runCommand = (command: string, args: string[]) => {
    calls.push({ command, args });
    const commandLine = [command, ...args].join(' ');

    if (commandLine === 'git rev-parse HEAD') {
      return CLASSROOM_SHA;
    }

    if (commandLine === 'git rev-parse origin/main') {
      return ORIGIN_SHA;
    }

    if (commandLine === 'git rev-parse HEAD:upstream/openpath') {
      return OPENPATH_SHA;
    }

    if (commandLine === 'git remote get-url origin') {
      return 'git@github.com:BalejosG/ClassroomPath.git';
    }

    if (command === 'gh' && args[0] === 'api' && args[1].includes('/commits/')) {
      return JSON.stringify({
        check_runs: [
          { name: 'CI Success', status: 'completed', conclusion: 'success' },
          {
            name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      });
    }

    if (command === 'gh' && args[0] === 'run' && args[1] === 'list') {
      if (args.includes('release-candidate-images.yml')) {
        return JSON.stringify([
          {
            databaseId: 123456,
            headSha: CLASSROOM_SHA,
            event: 'push',
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

    if (command === 'gh' && args[0] === 'run' && args[1] === 'view') {
      return JSON.stringify({
        artifacts: [{ name: `release-candidate-images-${CLASSROOM_SHA}`, expired: false }],
      });
    }

    if (command === 'gh' && args[0] === 'api' && args[1].includes('/artifacts')) {
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
  assert.equal(
    commandLines.some((line) =>
      /(git push|git tag|gh workflow run|gh run rerun|npm run deploy|promote:production)/.test(line)
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
});

test('CLI emits JSON when requested', () => {
  const result = spawnSync(process.execPath, [cliPath, '--json', '--sha', CLASSROOM_SHA], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_TEST_MANIFEST: manifestText,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.classroomPath.headSha, CLASSROOM_SHA);
  assert.equal(payload.releaseCandidate.manifest.linux_agent_apt_suite, 'unstable');
});
