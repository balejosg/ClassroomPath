import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { runProductionEnrollmentDownloadCanary } from '../scripts/production-enrollment-download-canary.mjs';

describe('production enrollment download canary', () => {
  test('downloads live Linux and Windows enrollment scripts and writes sanitized evidence', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runProductionEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.eu/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      outputPath,
      now: () => new Date('2026-04-23T08:00:00.000Z'),
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: String(init?.headers?.Authorization ?? ''),
        });

        if (String(url).endsWith('/windows.ps1')) {
          return new Response(
            [
              "$ErrorActionPreference = 'Stop'",
              "$ProgressPreference = 'SilentlyContinue'",
              '$env:OPENPATH_VERSION = "0.0.20260421051157"',
              'api/agent/windows/bootstrap/manifest',
              'Install-OpenPath.ps1',
            ].join('\n'),
            { status: 200 }
          );
        }

        return new Response(
          [
            '#!/usr/bin/env bash',
            "LINUX_AGENT_VERSION='0.0.20260421051157'",
            'apt-bootstrap.sh',
          ].join('\n'),
          { status: 200 }
        );
      },
    });

    assert.deepEqual(
      requests.map((request) => request.url),
      [
        'https://classroompath.eu/api/enroll/classroom-123',
        'https://classroompath.eu/api/enroll/classroom-123/windows.ps1',
      ]
    );
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ['Bearer secret-token', 'Bearer secret-token']
    );
    assert.equal(evidence.generatedAt, '2026-04-23T08:00:00.000Z');
    assert.equal(evidence.environment, 'production');
    assert.equal(evidence.baseUrl, 'https://classroompath.eu');
    assert.equal(evidence.linux.status, 200);
    assert.equal(evidence.linux.ok, true);
    assert.equal(evidence.linux.markerChecks.hasBashShebang, true);
    assert.equal(evidence.linux.markerChecks.hasExpectedLinuxAgentVersion, true);
    assert.equal(evidence.windows.status, 200);
    assert.equal(evidence.windows.ok, true);
    assert.equal(evidence.windows.markerChecks.hasBootstrapManifestPath, true);

    const serializedEvidence = readFileSync(outputPath, 'utf8');
    assert.ok(!serializedEvidence.includes('secret-token'));
    assert.ok(!serializedEvidence.includes('Install-OpenPath.ps1'));
  });

  test('keeps failed response diagnostics bounded and does not treat error text as a script marker', async () => {
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runProductionEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.eu/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260423054341',
      outputPath,
      now: () => new Date('2026-04-23T08:30:00.000Z'),
      fetchImpl: async (url) => {
        if (String(url).endsWith('/windows.ps1')) {
          return new Response(
            [
              "$ErrorActionPreference = 'Stop'",
              "$ProgressPreference = 'SilentlyContinue'",
              '$env:OPENPATH_VERSION = "0.0.20260421051157"',
              'api/agent/windows/bootstrap/manifest',
              'Install-OpenPath.ps1',
            ].join('\n'),
            { status: 200 }
          );
        }

        return new Response(
          'OPENPATH_LINUX_AGENT_VERSION 0.0.20260423054341 is not advertised by APT suites unstable, stable',
          { status: 500 }
        );
      },
    });

    assert.equal(evidence.linux.status, 500);
    assert.equal(evidence.linux.ok, false);
    assert.equal(evidence.linux.markerChecks.hasLinuxAgentVersionAssignment, false);
    assert.equal(evidence.linux.markerChecks.hasExpectedLinuxAgentVersion, false);
    assert.match(
      evidence.linux.failurePreview ?? '',
      /not advertised by APT suites unstable, stable/
    );
    assert.equal(evidence.windows.ok, true);
  });
});
