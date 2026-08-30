import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

import {
  CANONICAL_ARTIFACT_VOLUME_KEY,
  LEGACY_RETIREMENT_CONFIRMATION_ENV,
  LEGACY_ARTIFACT_VOLUME_KEY,
  LEGACY_RETIREMENT_CONFIRMATION_FLAG,
  parseLegacyRetirementCliArgs,
  retireLegacyWindowsOfflineInstallerStorage,
} from '../scripts/retire-windows-offline-installer-legacy-storage.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const projectName = 'classroompath-test';
const legacyVolumeName = `${projectName}_${LEGACY_ARTIFACT_VOLUME_KEY}`;
const canonicalVolumeName = `${projectName}_${CANONICAL_ARTIFACT_VOLUME_KEY}`;
const legacyLabels = {
  'com.docker.compose.project': projectName,
  'com.docker.compose.volume': LEGACY_ARTIFACT_VOLUME_KEY,
};

type DockerCommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function success(stdout = ''): DockerCommandResult {
  return { status: 0, stdout, stderr: '' };
}

function failure(
  stderr = `Error response from daemon: get ${legacyVolumeName}: no such volume`
): DockerCommandResult {
  return { status: 1, stdout: '', stderr };
}

function inspectVolume(
  name: string,
  labels: Record<string, string> = legacyLabels
): DockerCommandResult {
  return success(
    JSON.stringify([
      {
        Name: name,
        Driver: 'local',
        Labels: labels,
      },
    ])
  );
}

function runnerFor(
  options: {
    inspect?: DockerCommandResult;
    listedNames?: string[];
    remove?: DockerCommandResult;
  } = {}
) {
  const calls: string[][] = [];
  const runDocker = async (args: string[]): Promise<DockerCommandResult> => {
    calls.push(args);

    if (args[0] === 'volume' && args[1] === 'inspect') {
      return options.inspect ?? inspectVolume(legacyVolumeName);
    }
    if (args[0] === 'volume' && args[1] === 'ls') {
      return success((options.listedNames ?? [legacyVolumeName]).join('\n'));
    }
    if (args[0] === 'volume' && args[1] === 'rm') {
      return options.remove ?? success(legacyVolumeName);
    }

    throw new Error(`unexpected docker command: ${args.join(' ')}`);
  };

  return { calls, runDocker };
}

describe('legacy Windows offline installer storage retirement', () => {
  it('fails closed without the explicit legacy retirement confirmation', async () => {
    const { calls, runDocker } = runnerFor();

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({ projectName, runDocker }),
      /explicit legacy-retirement confirmation/u
    );
    assert.deepEqual(calls, [], 'confirmation must be checked before Docker mutation or lookup');
  });

  it('does not treat the DB confirmation environment variable as storage confirmation', async () => {
    const { calls, runDocker } = runnerFor();
    const parsed = parseLegacyRetirementCliArgs(['--project-name', projectName], {
      [LEGACY_RETIREMENT_CONFIRMATION_ENV]: '1',
    });

    assert.equal(parsed.confirmedByCli, false);
    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({ ...parsed, runDocker }),
      /explicit legacy-retirement confirmation/u
    );
    assert.deepEqual(calls, [], 'DB migration confirmation must never authorize Docker deletion');
  });

  it('requires the effective Compose project to be supplied by the CLI', () => {
    assert.throws(
      () =>
        parseLegacyRetirementCliArgs([LEGACY_RETIREMENT_CONFIRMATION_FLAG], {
          COMPOSE_PROJECT_NAME: projectName,
          [LEGACY_RETIREMENT_CONFIRMATION_ENV]: '1',
        }),
      /--project-name/u
    );
  });

  it('accepts the CLI confirmation flag independently of the DB environment variable', async () => {
    const { calls, runDocker } = runnerFor();
    const parsed = parseLegacyRetirementCliArgs(
      ['--project-name', projectName, LEGACY_RETIREMENT_CONFIRMATION_FLAG],
      { [LEGACY_RETIREMENT_CONFIRMATION_ENV]: '1' }
    );

    assert.equal(parsed.confirmedByCli, true);
    const result = await retireLegacyWindowsOfflineInstallerStorage({ ...parsed, runDocker });

    assert.deepEqual(result, { status: 'removed', volumeName: legacyVolumeName });
    assert.ok(calls.some((args) => args[0] === 'volume' && args[1] === 'rm'));
  });

  it('removes only the exact, strongly identified legacy Compose volume', async () => {
    const { calls, runDocker } = runnerFor();

    const result = await retireLegacyWindowsOfflineInstallerStorage({
      projectName,
      confirmedByCli: true,
      runDocker,
    });

    assert.deepEqual(result, { status: 'removed', volumeName: legacyVolumeName });
    assert.deepEqual(
      calls.find((args) => args[0] === 'volume' && args[1] === 'rm'),
      ['volume', 'rm', legacyVolumeName]
    );
    assert.equal(
      calls.some(
        (args) => args[0] === 'volume' && args[1] === 'rm' && args[2] === canonicalVolumeName
      ),
      false,
      'the canonical OpenPath artifact volume must never be selected'
    );
  });

  it('accepts standard Compose metadata alongside the required identity labels', async () => {
    const { runDocker } = runnerFor({
      inspect: inspectVolume(legacyVolumeName, {
        ...legacyLabels,
        'com.docker.compose.config-hash': 'a'.repeat(64),
        'com.docker.compose.version': '2.39.4',
      }),
    });

    await assert.doesNotReject(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker,
      })
    );
  });

  it('treats an absent legacy volume as an idempotent success', async () => {
    const { calls, runDocker } = runnerFor({
      inspect: failure(),
      listedNames: [],
    });

    const result = await retireLegacyWindowsOfflineInstallerStorage({
      projectName,
      confirmedByCli: true,
      runDocker,
    });

    assert.deepEqual(result, { status: 'absent', volumeName: legacyVolumeName });
    assert.equal(
      calls.some((args) => args[0] === 'volume' && args[1] === 'rm'),
      false
    );
  });

  it('does not treat a Docker daemon outage as an absent volume', async () => {
    const { runDocker } = runnerFor({
      inspect: failure('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'),
      listedNames: [],
    });

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker,
      }),
      /Docker|resolve|inspect/u
    );
  });

  it('does not treat Docker permission errors as an absent volume', async () => {
    const { runDocker } = runnerFor({
      inspect: failure('permission denied while trying to connect to the Docker daemon socket'),
      listedNames: [],
    });

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker,
      }),
      /Docker|resolve|inspect/u
    );
  });

  it('does not treat an unrelated error containing the missing-volume phrase as absence', async () => {
    const { runDocker } = runnerFor({
      inspect: failure('unexpected backend failure: no such volume was reported elsewhere'),
      listedNames: [],
    });

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker,
      }),
      /Docker|resolve|inspect/u
    );
  });

  it('does not treat a missing-volume phrase in stdout plus a Docker error in stderr as absence', async () => {
    const { runDocker } = runnerFor({
      inspect: {
        status: 1,
        stdout: `Error response from daemon: get ${legacyVolumeName}: no such volume`,
        stderr: 'Cannot connect to the Docker daemon',
      },
      listedNames: [],
    });

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker,
      }),
      /Docker|resolve|inspect/u
    );
  });

  it('fails when the exact legacy volume disappears after label lookup', async () => {
    const { runDocker } = runnerFor({
      inspect: failure(),
      listedNames: [legacyVolumeName],
    });

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker,
      }),
      /disappeared|verification/u
    );
  });

  it('rejects missing or unexpected Compose labels before removal', async () => {
    const invalidLabelSets: Array<Record<string, string>> = [
      { 'com.docker.compose.project': projectName },
      {
        'com.docker.compose.project': projectName,
        'com.docker.compose.volume': CANONICAL_ARTIFACT_VOLUME_KEY,
      },
      {
        'com.docker.compose.project': 'another-project',
        'com.docker.compose.volume': LEGACY_ARTIFACT_VOLUME_KEY,
      },
      {
        ...legacyLabels,
        'com.example.unexpected': 'not-a-compose-identity-label',
      },
    ];

    for (const labels of invalidLabelSets) {
      const { calls, runDocker } = runnerFor({ inspect: inspectVolume(legacyVolumeName, labels) });

      await assert.rejects(
        retireLegacyWindowsOfflineInstallerStorage({
          projectName,
          confirmedByCli: true,
          runDocker,
        }),
        /identity|label|legacy/u
      );
      assert.equal(
        calls.some((args) => args[0] === 'volume' && args[1] === 'rm'),
        false
      );
    }
  });

  it('rejects a name-like candidate or the canonical volume rather than guessing', async () => {
    for (const listedName of [
      `${projectName}_windows-offline-installer-artifacts-old`,
      canonicalVolumeName,
    ]) {
      const { calls, runDocker } = runnerFor({
        inspect: failure(),
        listedNames: [listedName],
      });

      await assert.rejects(
        retireLegacyWindowsOfflineInstallerStorage({
          projectName,
          confirmedByCli: true,
          runDocker,
        }),
        /identity|ambiguous|canonical|legacy/u
      );
      assert.equal(
        calls.some((args) => args[0] === 'volume' && args[1] === 'rm'),
        false
      );
    }
  });

  it('rejects ambiguous project candidates and missing project identity', async () => {
    const ambiguous = runnerFor({
      inspect: failure(),
      listedNames: [legacyVolumeName, `${projectName}_windows-offline-installer-artifacts-other`],
    });

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        projectName,
        confirmedByCli: true,
        runDocker: ambiguous.runDocker,
      }),
      /ambiguous|identity/u
    );

    await assert.rejects(
      retireLegacyWindowsOfflineInstallerStorage({
        confirmedByCli: true,
        runDocker: ambiguous.runDocker,
      }),
      /project name/u
    );
  });

  it('keeps the retirement helper out of normal deploy wiring and broad deletion commands', () => {
    const compose = readFileSync(resolve(projectRoot, 'docker/docker-compose.yml'), 'utf8');
    const deployFiles = [
      'scripts/deploy-staging-local.sh',
      'scripts/deploy-staging-remote.sh',
      'scripts/deploy-production-remote.sh',
      'scripts/run-migrations.sh',
      'scripts/run-migrations-docker.sh',
      'scripts/run-migrations-image.sh',
      '.github/workflows/deploy.yml',
    ];
    const deployContent = deployFiles
      .map((path) => readFileSync(resolve(projectRoot, path), 'utf8'))
      .join('\n');
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/retire-windows-offline-installer-legacy-storage.mjs'),
      'utf8'
    );

    assert.equal(compose.includes('retire-windows-offline-installer-legacy-storage'), false);
    assert.equal(deployContent.includes('retire-windows-offline-installer-legacy-storage'), false);
    assert.equal(helper.includes('down -v'), false);
    assert.equal(helper.includes('volume prune'), false);
    assert.doesNotMatch(helper, /rm\s+-rf|rm\s+-f\s+['"]?\$\{?[^}]*VOLUME/u);
  });
});
