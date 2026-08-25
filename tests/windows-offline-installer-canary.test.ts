import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { runWindowsOfflineInstallerCanary } from '../scripts/windows-offline-installer-canary.mjs';

const artifact = Buffer.from('MZ-customized-installer');
const expectedSha256 = createHash('sha256').update(artifact).digest('hex');
const rawDownloadUrl = '/cp/api/windows-offline-installer/download?ref=raw-secret-ref';

function outputPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'cp-woi-canary-')), 'evidence.json');
}

function successfulFetch(requests: string[], reuseStatuses: number[] = [410]) {
  let downloads = 0;
  return async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')) {
      assert.equal(init?.body, JSON.stringify({ json: { classroomId: 'classroom-canary' } }));
      return new Response(
        JSON.stringify({
          result: {
            data: {
              fileName: 'OpenPath-Math-Windows-Setup.exe',
              version: '4.1.0',
              sha256: expectedSha256,
              downloadUrl: rawDownloadUrl,
              tokenExpiresAt: '2026-08-25T12:00:00.000Z',
              downloadExpiresAt: '2026-08-25T12:10:00.000Z',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    downloads += 1;
    if (downloads === 1) {
      return new Response(artifact, {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="OpenPath-Math-Windows-Setup.exe"',
        },
      });
    }
    return new Response('', {
      status: reuseStatuses[Math.min(downloads - 2, reuseStatuses.length - 1)],
    });
  };
}

describe('ClassroomPath Windows offline installer canary', () => {
  test('generates, downloads, hashes, and proves reuse returns 410', async () => {
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
    assert.equal(evidence.firstDownloadStatus, 200);
    assert.equal(evidence.reuseStatus, 410);
    assert.equal(evidence.reuseAttempts, 1);
    assert.equal(evidence.fileName, 'OpenPath-Math-Windows-Setup.exe');
    assert.equal(evidence.size, artifact.length);
    assert.equal(evidence.expectedSha256, expectedSha256);
    assert.equal(evidence.actualSha256, expectedSha256);
    assert.equal(evidence.shaMatches, true);
    assert.deepEqual(requests, [
      'POST https://staging.classroompath.example.invalid/cp/trpc/windowsOfflineInstaller.generate',
      `GET https://staging.classroompath.example.invalid${rawDownloadUrl}`,
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

  test('allows one short consistency retry when consumption is eventually visible', async () => {
    const evidence = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: outputPath(),
      reuseRetryDelaysMs: [0, 0],
      fetchImpl: successfulFetch([], [200, 410]),
    });
    assert.equal(evidence.result, 'success');
    assert.equal(evidence.reuseStatus, 410);
    assert.equal(evidence.reuseAttempts, 2);
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
    assert.equal(evidence.firstDownloadStatus, null);
    assert.equal(evidence.reuseStatus, null);
    assert.equal(readFileSync(pathToEvidence, 'utf8').includes('upstream failure'), false);
  });

  test('fails on non-200 download, empty/hash mismatch, or reusable reference', async () => {
    const firstFailure = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: outputPath(),
      fetchImpl: async (url) => {
        if (url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')) {
          return new Response(
            JSON.stringify({
              result: {
                data: {
                  fileName: 'OpenPath-Canary.exe',
                  sha256: expectedSha256,
                  downloadUrl: rawDownloadUrl,
                },
              },
            }),
            { status: 200 }
          );
        }
        return new Response('failed', { status: 503 });
      },
    });
    assert.equal(firstFailure.result, 'failed');
    assert.equal(firstFailure.firstDownloadStatus, 503);

    const generatedPayload = JSON.stringify({
      result: {
        data: {
          fileName: 'OpenPath-Canary.exe',
          sha256: expectedSha256,
          downloadUrl: rawDownloadUrl,
        },
      },
    });
    const empty = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: outputPath(),
      fetchImpl: (() => {
        let downloads = 0;
        return async (url: string) => {
          if (url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')) {
            return new Response(generatedPayload, { status: 200 });
          }
          if (url.includes('raw-secret-ref')) {
            downloads += 1;
            return downloads === 1
              ? new Response('', {
                  status: 200,
                  headers: { 'Content-Disposition': 'attachment; filename="OpenPath-Canary.exe"' },
                })
              : new Response('', { status: 410 });
          }
          return new Response('', { status: 410 });
        };
      })(),
    });
    assert.equal(empty.result, 'failed');
    assert.equal(empty.size, 0);
    assert.equal(empty.shaMatches, false);

    const mismatch = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: outputPath(),
      fetchImpl: (() => {
        let downloads = 0;
        return async (url: string) => {
          if (url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')) {
            return new Response(generatedPayload, { status: 200 });
          }
          if (url.includes('raw-secret-ref')) {
            downloads += 1;
            return downloads === 1
              ? new Response('wrong-bytes', {
                  status: 200,
                  headers: { 'Content-Disposition': 'attachment; filename="OpenPath-Canary.exe"' },
                })
              : new Response('', { status: 410 });
          }
          return new Response('', { status: 410 });
        };
      })(),
    });
    assert.equal(mismatch.result, 'failed');
    assert.equal(mismatch.shaMatches, false);

    const reusable = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: outputPath(),
      reuseRetryDelaysMs: [0, 0, 0, 0],
      fetchImpl: successfulFetch([], [200]),
    });
    assert.equal(reusable.result, 'failed');
    assert.equal(reusable.reuseStatus, 200);
    assert.equal(reusable.reuseAttempts, 4);
  });

  test('fails immediately on a reuse network error and bounds the retry window', async () => {
    const requests: string[] = [];
    const happyFetch = successfulFetch(requests);
    let downloadCalls = 0;
    const evidencePath = outputPath();
    const evidence = await runWindowsOfflineInstallerCanary({
      baseUrl: 'https://staging.classroompath.example.invalid',
      classroomId: 'classroom-canary',
      accessToken: 'jwt-secret',
      outputPath: evidencePath,
      reuseRetryDelaysMs: [0, 0, 0, 0],
      fetchImpl: async (url, init) => {
        if (url.endsWith('/cp/trpc/windowsOfflineInstaller.generate')) {
          return happyFetch(url, init);
        }
        downloadCalls += 1;
        if (downloadCalls === 1) return happyFetch(url, init);
        throw new Error('network down');
      },
    });

    assert.equal(evidence.result, 'failed');
    assert.equal(evidence.errorCode, 'REUSE_DOWNLOAD_FAILED');
    assert.equal(evidence.reuseAttempts, 1);
    assert.doesNotMatch(readFileSync(evidencePath, 'utf8'), /raw-secret-ref|Bearer|Authorization/);

    await assert.rejects(
      () =>
        runWindowsOfflineInstallerCanary({
          baseUrl: 'https://staging.classroompath.example.invalid',
          classroomId: 'classroom-canary',
          accessToken: 'jwt-secret',
          outputPath: outputPath(),
          reuseRetryDelaysMs: [0, 2001],
          fetchImpl: happyFetch,
        }),
      /short and bounded/
    );
  });
});
