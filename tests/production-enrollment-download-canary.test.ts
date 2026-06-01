import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { runEnrollmentDownloadCanary } from '../scripts/enrollment-download-canary.mjs';
import { runProductionEnrollmentDownloadCanary } from '../scripts/production-enrollment-download-canary.mjs';

function successfulFetch(
  requests: Array<{ url: string; authorization: string }>,
  options: {
    linuxVersion?: string;
    windowsScript?: string;
    linuxScript?: string;
  } = {}
) {
  const linuxVersion = options.linuxVersion ?? '0.0.20260421051157';
  const windowsScript =
    options.windowsScript ??
    [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      '$env:OPENPATH_VERSION = "0.0.20260421051157"',
      'api/agent/windows/bootstrap/manifest',
      'Install-OpenPath.ps1',
    ].join('\n');
  const linuxScript =
    options.linuxScript ??
    ['#!/usr/bin/env bash', `LINUX_AGENT_VERSION='${linuxVersion}'`, 'apt-bootstrap.sh'].join('\n');

  return async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      authorization: String(init?.headers?.Authorization ?? ''),
    });

    if (String(url).endsWith('/windows.ps1')) {
      return new Response(windowsScript, { status: 200 });
    }

    return new Response(linuxScript, { status: 200 });
  };
}

describe('production enrollment download canary', () => {
  test('generic helper downloads Linux and Windows scripts and writes sanitized staging evidence', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runEnrollmentDownloadCanary({
      baseUrl: 'https://staging.classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      environment: 'staging',
      outputPath,
      now: () => new Date('2026-04-23T08:00:00.000Z'),
      fetchImpl: successfulFetch(requests),
    });

    assert.deepEqual(
      requests.map((request) => request.url),
      [
        'https://staging.classroompath.example.invalid/api/enroll/classroom-123',
        'https://staging.classroompath.example.invalid/api/enroll/classroom-123/windows.ps1',
      ]
    );
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ['Bearer secret-token', 'Bearer secret-token']
    );
    assert.equal(evidence.generatedAt, '2026-04-23T08:00:00.000Z');
    assert.equal(evidence.environment, 'staging');
    assert.equal(evidence.result, 'success');
    assert.equal(evidence.baseUrl, 'https://staging.classroompath.example.invalid');
    assert.equal(evidence.linux.status, 200);
    assert.equal(evidence.linux.ok, true);
    assert.equal(evidence.linux.result, 'success');
    assert.equal(evidence.linux.markerChecks.hasBashShebang, true);
    assert.equal(evidence.linux.markerChecks.hasExpectedLinuxAgentVersion, true);
    assert.equal(evidence.windows.status, 200);
    assert.equal(evidence.windows.ok, true);
    assert.equal(evidence.windows.result, 'success');
    assert.equal(evidence.windows.markerChecks.hasBootstrapManifestPath, true);
    assert.equal('hasEnrollmentTitle' in evidence.windows.markerChecks, false);

    const serializedEvidence = readFileSync(outputPath, 'utf8');
    assert.ok(!serializedEvidence.includes('secret-token'));
    assert.ok(!serializedEvidence.includes('Install-OpenPath.ps1'));
    assert.ok(!serializedEvidence.includes('apt-bootstrap.sh'));
  });

  test('keeps failed response diagnostics bounded and does not treat error text as a script marker', async () => {
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runProductionEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
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

  test('production wrapper preserves the production environment contract', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runProductionEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      outputPath,
      now: () => new Date('2026-04-23T09:00:00.000Z'),
      fetchImpl: successfulFetch(requests),
    });

    assert.equal(evidence.environment, 'production');
    assert.equal(evidence.result, 'success');
  });

  test('fails Windows script checks when bootstrap manifest path is missing', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      environment: 'production',
      outputPath,
      fetchImpl: successfulFetch(requests, {
        windowsScript: [
          '$env:OPENPATH_VERSION = "0.0.20260421051157"',
          'Install-OpenPath.ps1',
        ].join('\n'),
      }),
    });

    assert.equal(evidence.windows.ok, false);
    assert.equal(evidence.windows.result, 'failed');
    assert.equal(evidence.windows.markerChecks.hasBootstrapManifestPath, false);
    assert.equal(evidence.result, 'failed');
  });

  test('fails Windows script checks when OPENPATH_VERSION export is missing', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      environment: 'production',
      outputPath,
      fetchImpl: successfulFetch(requests, {
        windowsScript: ['api/agent/windows/bootstrap/manifest', 'Install-OpenPath.ps1'].join('\n'),
      }),
    });

    assert.equal(evidence.windows.ok, false);
    assert.equal(evidence.windows.markerChecks.hasOpenPathVersionEnv, false);
    assert.equal(evidence.result, 'failed');
  });

  test('fails Windows script checks when expected captive portal domains are missing', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      expectedCaptivePortalDomains: ['login.microsoftonline.com'],
      environment: 'production',
      outputPath,
      fetchImpl: successfulFetch(requests),
    });

    assert.equal(evidence.windows.ok, false);
    assert.equal(evidence.windows.result, 'failed');
    assert.equal(evidence.windows.markerChecks.hasCaptivePortalDomainsVariable, false);
    assert.equal(evidence.windows.markerChecks.hasCaptivePortalDomainsArgument, false);
    assert.deepEqual(evidence.windows.markerChecks.expectedCaptivePortalDomains, {
      'login.microsoftonline.com': false,
    });
    assert.equal(evidence.result, 'failed');
  });

  test('passes Windows script checks when expected captive portal domains are present', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260421051157',
      expectedCaptivePortalDomains: [' Login.MicrosoftOnline.COM '],
      environment: 'production',
      outputPath,
      fetchImpl: successfulFetch(requests, {
        windowsScript: [
          "$ErrorActionPreference = 'Stop'",
          "$ProgressPreference = 'SilentlyContinue'",
          '$env:OPENPATH_VERSION = "0.0.20260421051157"',
          '$CaptivePortalDomains = @("login.microsoftonline.com")',
          'api/agent/windows/bootstrap/manifest',
          'Install-OpenPath.ps1',
          "$InstallArgs += @('-CaptivePortalDomains', $CaptivePortalDomains)",
        ].join('\n'),
      }),
    });

    assert.equal(evidence.windows.ok, true);
    assert.equal(evidence.windows.markerChecks.hasCaptivePortalDomainsVariable, true);
    assert.equal(evidence.windows.markerChecks.hasCaptivePortalDomainsArgument, true);
    assert.deepEqual(evidence.windows.markerChecks.expectedCaptivePortalDomains, {
      'login.microsoftonline.com': true,
    });
    assert.equal(evidence.result, 'success');
  });

  test('fails Linux script checks when the expected version is absent', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const outputPath = join(mkdtempSync(join(tmpdir(), 'cp-enrollment-canary-')), 'evidence.json');

    const evidence = await runEnrollmentDownloadCanary({
      baseUrl: 'https://classroompath.example.invalid/',
      classroomId: 'classroom-123',
      enrollmentToken: 'secret-token',
      expectedLinuxAgentVersion: '0.0.20260423054341',
      environment: 'production',
      outputPath,
      fetchImpl: successfulFetch(requests, {
        linuxVersion: '0.0.20260421051157',
      }),
    });

    assert.equal(evidence.linux.ok, false);
    assert.equal(evidence.linux.markerChecks.hasExpectedLinuxAgentVersion, false);
    assert.equal(evidence.result, 'failed');
  });
});
