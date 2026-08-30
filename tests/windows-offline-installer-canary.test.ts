import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { runWindowsOfflineInstallerCanary } from '../scripts/windows-offline-installer-canary.mjs';

const artifact = Buffer.from('MZ-customized-installer');
const expectedSha256 = createHash('sha256').update(artifact).digest('hex');
const rawDownloadUrl = '/api/windows-offline-installer/download?ref=raw-secret-ref';

function outputPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'cp-woi-canary-')), 'evidence.json');
}

function generatedPayload(downloadUrl = rawDownloadUrl) {
  return {
    result: {
      data: {
        fileName: 'OpenPath-Math-Windows-Setup.exe',
        version: '4.1.0',
        sha256: expectedSha256,
        downloadUrl,
        tokenExpiresAt: '2026-08-25T12:00:00.000Z',
        downloadExpiresAt: '2026-08-25T12:10:00.000Z',
      },
    },
  };
}

function successfulFetch(requests: string[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')) {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer jwt-secret');
      assert.equal(init?.body, JSON.stringify({ classroomId: 'classroom-canary' }));
      return new Response(JSON.stringify(generatedPayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(artifact, {
      status: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="OpenPath-Math-Windows-Setup.exe"',
        'Content-Length': String(artifact.length),
      },
    });
  };
}

describe('ClassroomPath Windows offline installer canary', () => {
  test('proves wrapper generate, canonical download, attachment, length, and SHA', async () => {
    const requests: string[] = [];
    const pathToEvidence = outputPath();
    const evidence = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid/',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: pathToEvidence,
      fetchImpl: successfulFetch(requests),
    });

    assert.equal(evidence.result, 'success');
    assert.equal(evidence.generated, true);
    assert.equal(evidence.downloadStatus, 200);
    assert.equal(evidence.fileName, 'OpenPath-Math-Windows-Setup.exe');
    assert.equal(evidence.size, artifact.length);
    assert.equal(evidence.contentLength, artifact.length);
    assert.equal(evidence.contentLengthMatches, true);
    assert.equal(evidence.expectedSha256, expectedSha256);
    assert.equal(evidence.actualSha256, expectedSha256);
    assert.equal(evidence.shaMatches, true);
    assert.equal(evidence.attachment, true);
    assert.equal(evidence.canonicalPath, true);
    assert.deepEqual(requests, [
      'POST https://staging.classroompath.example.invalid/cp/trpc/windowsOfflineInstaller.generate',
      `GET https://staging.classroompath.example.invalid${rawDownloadUrl}`,
    ]);

    const serialized = readFileSync(pathToEvidence, 'utf8');
    for (const secret of [
      rawDownloadUrl,
      'raw-secret-ref',
      'jwt-secret',
      'Authorization',
      'Bearer',
      'enrollmentToken',
    ]) {
      assert.equal(serialized.includes(secret), false, `evidence leaked ${secret}`);
    }
  });

  test('rejects a download URL that would bypass the ClassroomPath gateway', async () => {
    const evidence = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: outputPath(),
      fetchImpl: async (url) => {
        assert.ok(url.endsWith('/cp/trpc/windowsOfflineInstaller.generate'));
        return new Response(
          JSON.stringify(
            generatedPayload(
              'https://openpath.example/api/windows-offline-installer/download?ref=opaque'
            )
          ),
          { status: 200 }
        );
      },
    });

    assert.equal(evidence.result, 'failed');
    assert.equal(evidence.errorCode, 'GENERATE_CONTRACT_INVALID');
    assert.equal(evidence.downloadStatus, null);
  });

  test('rejects credentials, fragments, and extra download query parameters', async () => {
    for (const downloadUrl of [
      'https://@staging.classroompath.example.invalid/api/windows-offline-installer/download?ref=opaque',
      'https://staging.classroompath.example.invalid/api/windows-offline-installer/download?ref=opaque#',
      'https://staging.classroompath.example.invalid/api/windows-offline-installer/download?ref=opaque&extra=1',
    ]) {
      const evidence = await runWindowsOfflineInstallerCanary({
        baseUrl: 'https://staging.classroompath.example.invalid',
        classroomId: 'classroom-canary',
        accessToken: 'jwt-secret',
        outputPath: outputPath(),
        fetchImpl: async (url) =>
          url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')
            ? new Response(JSON.stringify(generatedPayload(downloadUrl)), { status: 200 })
            : new Response(artifact, { status: 200 }),
      });

      assert.equal(evidence.result, 'failed');
      assert.equal(evidence.errorCode, 'GENERATE_CONTRACT_INVALID');
      assert.equal(evidence.downloadStatus, null);
    }
  });

  test('rejects a canary base URL that is not a bare public origin', async () => {
    for (const baseUrl of [
      'https://staging.classroompath.example.invalid/app',
      'https://staging.classroompath.example.invalid/./',
      'https://staging.classroompath.example.invalid/%2e%2e',
      'https://@staging.classroompath.example.invalid',
      'https://user:password@staging.classroompath.example.invalid',
      'https://staging.classroompath.example.invalid?tenant=one',
      'https://staging.classroompath.example.invalid?',
      'https://staging.classroompath.example.invalid#fragment',
      'https://staging.classroompath.example.invalid#',
      'https://staging.classroompath.example.invalid\\foo',
      'https://staging.classroompath.example.invalid\\',
      ' https://staging.classroompath.example.invalid',
      'https://staging.classroompath.example.invalid ',
      'https://staging.classroompath.example.invalid\n',
      'https://staging.classroompath.example.invalid\u200bfoo',
      'https://staging.classroompath.example.invalid\ufefffoo',
      'https://%73taging.classroompath.example.invalid',
      'https://[0:0:0:0:0:0:0:1]',
    ]) {
      await assert.rejects(
        runWindowsOfflineInstallerCanary({
          baseUrl,
          classroomId: 'classroom-canary',
          accessToken: 'jwt-secret',
          outputPath: outputPath(),
          fetchImpl: async () => {
            throw new Error('fetch must not run for an invalid base URL');
          },
        }),
        /bare.*origin/u
      );
    }
  });

  test('fails safely when generation fails', async () => {
    const pathToEvidence = outputPath();
    const evidence = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: pathToEvidence,
      fetchImpl: async () => new Response('upstream failure', { status: 500 }),
    });

    assert.equal(evidence.result, 'failed');
    assert.equal(evidence.generated, false);
    assert.equal(evidence.downloadStatus, null);
    assert.equal(readFileSync(pathToEvidence, 'utf8').includes('upstream failure'), false);
  });

  test('fails on empty bytes, missing length, or a hash mismatch', async () => {
    const cases = [
      new Response('', {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="OpenPath-Math-Windows-Setup.exe"',
          'Content-Length': '0',
        },
      }),
      new Response(artifact, {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="OpenPath-Math-Windows-Setup.exe"',
        },
      }),
      new Response('wrong-bytes', {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="OpenPath-Math-Windows-Setup.exe"',
          'Content-Length': '11',
        },
      }),
    ];

    for (const downloadResponse of cases) {
      const evidence = await runWindowsOfflineInstallerCanary({
        baseUrl: 'https://staging.classroompath.example.invalid',
        classroomId: 'classroom-canary',
        accessToken: 'jwt-secret',
        outputPath: outputPath(),
        fetchImpl: async (url) =>
          url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')
            ? new Response(JSON.stringify(generatedPayload()), { status: 200 })
            : downloadResponse,
      });

      assert.equal(evidence.result, 'failed');
      assert.equal(
        evidence.contentLengthMatches && evidence.shaMatches,
        false,
        'a malformed download must fail a binary contract check'
      );
    }
  });
});
