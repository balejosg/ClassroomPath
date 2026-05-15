import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { runGhcrPreflightCommand } from '../scripts/ghcr-preflight.mjs';
import {
  classifyGhcrPreflightFailure,
  collectGhcrImagesFromManifest,
  preflightGhcrImages,
  preflightGhcrImagesOnStaging,
} from '../scripts/lib/ghcr-preflight.mjs';

describe('classifyGhcrPreflightFailure', () => {
  it('classifies denied registry output as auth failure', () => {
    const result = classifyGhcrPreflightFailure(
      'Error response from daemon: error from registry: denied'
    );

    assert.equal(result.kind, 'auth-denied');
    assert.match(result.message, /STAGING_GHCR_USERNAME/);
  });

  it('classifies unauthorized registry output as auth failure', () => {
    const result = classifyGhcrPreflightFailure('unauthorized: authentication required');

    assert.equal(result.kind, 'auth-denied');
    assert.match(result.message, /STAGING_GHCR_TOKEN/);
  });

  it('classifies missing manifests separately from auth failures', () => {
    const result = classifyGhcrPreflightFailure('failed to resolve: manifest unknown');

    assert.equal(result.kind, 'manifest-unknown');
    assert.match(result.message, /release-candidate image manifest/);
  });

  it('classifies network failures separately from registry failures', () => {
    const result = classifyGhcrPreflightFailure('dial tcp: lookup ghcr.io: no such host');

    assert.equal(result.kind, 'network');
    assert.match(result.message, /network/);
  });
});

describe('collectGhcrImagesFromManifest', () => {
  it('collects GHCR image refs from shell-compatible manifests in stable order', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ghcr-preflight-manifest-'));
    const manifestPath = join(tempDir, 'release-candidate-images.env');

    writeFileSync(
      manifestPath,
      [
        'APP_SHA=abc123',
        'CLASSROOMPATH_GATEWAY_IMAGE=ghcr.io/balejosg/classroompath-gateway@sha256:1',
        'CLASSROOMPATH_MIGRATIONS_IMAGE=ghcr.io/balejosg/classroompath-migrations@sha256:2',
        'OPENPATH_API_IMAGE=ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
        'CLASSROOMPATH_SPA_IMAGE=ghcr.io/balejosg/classroompath-spa@sha256:4',
        'CLASSROOMPATH_VERIFIER_IMAGE=ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
        'OPENPATH_FIREFOX_ASSETS_IMAGE=ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:6',
        'IGNORED_URL=https://ghcr.io/not-an-image',
        '',
      ].join('\n')
    );

    assert.deepEqual(collectGhcrImagesFromManifest(manifestPath), [
      'ghcr.io/balejosg/classroompath-gateway@sha256:1',
      'ghcr.io/balejosg/classroompath-migrations@sha256:2',
      'ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
      'ghcr.io/balejosg/classroompath-spa@sha256:4',
      'ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
      'ghcr.io/balejosg/classroompath-openpath-firefox-assets@sha256:6',
    ]);
  });
});

describe('preflightGhcrImages', () => {
  it('inspects each image with docker buildx imagetools locally', async () => {
    const calls: string[][] = [];

    const result = await preflightGhcrImages(['ghcr.io/balejosg/image@sha256:1'], {
      execFile: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: 'ok', stderr: '' };
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      ['docker', 'buildx', 'imagetools', 'inspect', 'ghcr.io/balejosg/image@sha256:1'],
    ]);
  });
});

describe('preflightGhcrImagesOnStaging', () => {
  it('checks remote docker access over SSH before inspecting images', async () => {
    const calls: string[][] = [];

    const result = await preflightGhcrImagesOnStaging(['ghcr.io/balejosg/image@sha256:1'], {
      env: {
        STAGING_SSH_KEY: '/tmp/staging.key',
        STAGING_HOST: 'staging.local',
        STAGING_USER: 'deploy',
        STAGING_PORT: '2222',
      },
      execFile: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: '', stderr: '' };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]?.slice(-1), ['docker version >/dev/null']);
    assert.deepEqual(calls[1]?.slice(-1), [
      "docker buildx imagetools inspect 'ghcr.io/balejosg/image@sha256:1'",
    ]);
  });

  it('logs into GHCR remotely when staging credentials are provided', async () => {
    const calls: string[][] = [];

    await preflightGhcrImagesOnStaging(['ghcr.io/balejosg/image@sha256:1'], {
      env: {
        STAGING_SSH_KEY: '/tmp/staging.key',
        STAGING_HOST: 'staging.local',
        STAGING_GHCR_USERNAME: 'balejosg',
        STAGING_GHCR_TOKEN: 'token',
      },
      execFile: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: '', stderr: '' };
      },
    });

    assert.match(calls[1]?.at(-1) ?? '', /docker login ghcr\.io -u 'balejosg'/);
    assert.match(calls[1]?.at(-1) ?? '', /--password-stdin/);
  });
});

describe('ghcr-preflight CLI', () => {
  it('supports local --image without touching staging', async () => {
    const calls: string[][] = [];

    const output = await runCommand(['local', '--image', 'ghcr.io/balejosg/image@sha256:1'], {
      execFile: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: '', stderr: '' };
      },
    });

    assert.equal(output.status, 0);
    assert.match(output.stdout, /GHCR preflight passed/);
    assert.deepEqual(calls, [
      ['docker', 'buildx', 'imagetools', 'inspect', 'ghcr.io/balejosg/image@sha256:1'],
    ]);
  });

  it('supports staging --manifest-file through injected SSH runner', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ghcr-preflight-cli-'));
    const manifestPath = join(tempDir, 'release-candidate-images.env');
    const calls: string[][] = [];

    writeFileSync(
      manifestPath,
      'CLASSROOMPATH_VERIFIER_IMAGE=ghcr.io/balejosg/verifier@sha256:1\n'
    );

    const output = await runCommand(['staging', '--manifest-file', manifestPath], {
      env: {
        STAGING_SSH_KEY: '/tmp/staging.key',
        STAGING_HOST: 'staging.local',
      },
      execFile: async (command, args) => {
        calls.push([command, ...args]);
        return { stdout: '', stderr: '' };
      },
      loadEnvFile: () => {},
    });

    assert.equal(output.status, 0);
    assert.match(output.stdout, /checked 1 image/);
    assert.equal(calls[0]?.[0], 'ssh');
  });
});

async function runCommand(args: string[], dependencies = {}) {
  let stdout = '';
  let stderr = '';
  const result = await runGhcrPreflightCommand(['node', 'scripts/ghcr-preflight.mjs', ...args], {
    stdout: (value: string) => {
      stdout += value;
    },
    stderr: (value: string) => {
      stderr += value;
    },
    ...dependencies,
  });

  return { ...result, stdout, stderr };
}
