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
  deriveReleaseBlockers,
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

function createCommandHarness(options: { originSha?: string; openpathCheckStatus?: string } = {}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const originSha = options.originSha ?? ORIGIN_SHA;
  const openpathCheckStatus = options.openpathCheckStatus ?? 'success';

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

    if (commandLine === 'git remote get-url origin') {
      return 'git@github.com:BalejosG/ClassroomPath.git';
    }

    if (command === 'gh' && args[0] === 'api' && args[1].includes('/commits/')) {
      return JSON.stringify({
        check_runs: [
          { name: 'CI Success', status: 'completed', conclusion: openpathCheckStatus },
          {
            name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
            status: 'completed',
            conclusion: openpathCheckStatus,
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
  const binDir = createReleaseStatusFakeBin();
  const result = spawnSync(process.execPath, [cliPath, '--json', '--sha', CLASSROOM_SHA], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      RELEASE_STATUS_TEST_MODE: '1',
      RELEASE_STATUS_TEST_MANIFEST: manifestText,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.classroomPath.headSha, CLASSROOM_SHA);
  assert.equal(payload.classroompath.head, CLASSROOM_SHA);
  assert.equal(payload.openpath.submoduleSha, OPENPATH_SHA);
  assert.equal(payload.releaseCandidate.manifest.linux_agent_apt_suite, 'unstable');
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
  assert.deepEqual(payload.blockers, []);
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
