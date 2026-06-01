#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const DEFAULT_ENROLLMENT_CANARY_OUTPUT_PATH = 'enrollment-download-canary.json';

function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('ENROLLMENT_CANARY_BASE_URL is required');
  }
  return normalized;
}

function requireValue(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeEnvironment(environment) {
  const normalized = String(environment ?? '').trim() || 'production';
  if (normalized !== 'staging' && normalized !== 'production') {
    throw new Error(
      `ENROLLMENT_CANARY_ENVIRONMENT must be staging or production (actual=${normalized})`
    );
  }
  return normalized;
}

function contentLength(content) {
  return Buffer.byteLength(String(content ?? ''), 'utf8');
}

function normalizeExpectedCaptivePortalDomains(domains) {
  const values = Array.isArray(domains)
    ? domains
    : String(domains ?? '')
        .split(',')
        .map((domain) => domain.trim());

  return Array.from(
    new Set(values.map((domain) => String(domain).trim().toLowerCase()).filter(Boolean))
  );
}

function linuxMarkerChecks(content, expectedLinuxAgentVersion) {
  const script = String(content ?? '');
  const checks = {
    hasBashShebang: /^#!.*bash/m.test(script),
    hasLinuxAgentVersionAssignment: /LINUX_AGENT_VERSION=/.test(script),
    hasAptBootstrapReference: /apt-bootstrap\.sh/.test(script),
  };

  if (expectedLinuxAgentVersion) {
    checks.hasExpectedLinuxAgentVersion =
      checks.hasLinuxAgentVersionAssignment && script.includes(expectedLinuxAgentVersion);
  }

  return checks;
}

function windowsMarkerChecks(content, expectedCaptivePortalDomains = []) {
  const script = String(content ?? '');
  const checks = {
    hasBootstrapManifestPath: script.includes('api/agent/windows/bootstrap/manifest'),
    hasOpenPathVersionEnv: script.includes('$env:OPENPATH_VERSION'),
    hasInstallScriptReference: script.includes('Install-OpenPath.ps1'),
  };
  const captivePortalDomains = normalizeExpectedCaptivePortalDomains(expectedCaptivePortalDomains);

  if (captivePortalDomains.length > 0) {
    checks.hasCaptivePortalDomainsVariable = script.includes('$CaptivePortalDomains');
    checks.hasCaptivePortalDomainsArgument =
      /-CaptivePortalDomains['"]?\s*,\s*\$CaptivePortalDomains/.test(script);
    checks.expectedCaptivePortalDomains = Object.fromEntries(
      captivePortalDomains.map((domain) => [domain, script.toLowerCase().includes(domain)])
    );
  }

  return checks;
}

function allChecksPass(checks) {
  return Object.values(checks).every(Boolean);
}

function boundedFailurePreview(status, body) {
  if (status === 200) {
    return undefined;
  }

  return String(body ?? '').slice(0, 1000);
}

async function downloadScript({ url, enrollmentToken, fetchImpl }) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${enrollmentToken}`,
    },
  });
  const body = await response.text();

  return {
    status: response.status,
    body,
  };
}

function scriptEvidence({ url, response, markerChecks }) {
  const ok =
    response.status === 200 && contentLength(response.body) > 0 && allChecksPass(markerChecks);

  return {
    url,
    status: response.status,
    contentLength: contentLength(response.body),
    ok,
    result: ok ? 'success' : 'failed',
    markerChecks,
    failurePreview: boundedFailurePreview(response.status, response.body),
  };
}

export async function runEnrollmentDownloadCanary({
  baseUrl,
  classroomId,
  enrollmentToken,
  expectedLinuxAgentVersion = '',
  expectedCaptivePortalDomains = [],
  environment = 'production',
  outputPath = DEFAULT_ENROLLMENT_CANARY_OUTPUT_PATH,
  now = () => new Date(),
  fetchImpl = fetch,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedClassroomId = encodeURIComponent(
    requireValue(classroomId, 'ENROLLMENT_CANARY_CLASSROOM_ID')
  );
  const normalizedEnrollmentToken = requireValue(enrollmentToken, 'ENROLLMENT_CANARY_TOKEN');
  const normalizedEnvironment = normalizeEnvironment(environment);
  const linuxUrl = `${normalizedBaseUrl}/api/enroll/${normalizedClassroomId}`;
  const windowsUrl = `${linuxUrl}/windows.ps1`;

  const [linux, windows] = await Promise.all([
    downloadScript({
      url: linuxUrl,
      enrollmentToken: normalizedEnrollmentToken,
      fetchImpl,
    }),
    downloadScript({
      url: windowsUrl,
      enrollmentToken: normalizedEnrollmentToken,
      fetchImpl,
    }),
  ]);

  const linuxEvidence = scriptEvidence({
    url: linuxUrl,
    response: linux,
    markerChecks: linuxMarkerChecks(linux.body, expectedLinuxAgentVersion),
  });
  const windowsEvidence = scriptEvidence({
    url: windowsUrl,
    response: windows,
    markerChecks: windowsMarkerChecks(windows.body, expectedCaptivePortalDomains),
  });
  const ok = linuxEvidence.ok && windowsEvidence.ok;
  const evidence = {
    generatedAt: now().toISOString(),
    environment: normalizedEnvironment,
    result: ok ? 'success' : 'failed',
    baseUrl: normalizedBaseUrl,
    linux: linuxEvidence,
    windows: windowsEvidence,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowSha: process.env.GITHUB_SHA || null,
  };

  writeFileSync(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  return undefined;
}

async function main() {
  const evidence = await runEnrollmentDownloadCanary({
    baseUrl: envValue('ENROLLMENT_CANARY_BASE_URL', 'PRODUCTION_ENROLLMENT_CANARY_BASE_URL'),
    classroomId: envValue('ENROLLMENT_CANARY_CLASSROOM_ID', 'CLASSROOM_ID'),
    enrollmentToken: envValue('ENROLLMENT_CANARY_TOKEN', 'ENROLLMENT_TOKEN'),
    expectedLinuxAgentVersion: envValue(
      'ENROLLMENT_CANARY_EXPECTED_LINUX_AGENT_VERSION',
      'OPENPATH_LINUX_AGENT_VERSION'
    ),
    expectedCaptivePortalDomains: envValue('ENROLLMENT_CANARY_EXPECTED_CAPTIVE_PORTAL_DOMAINS'),
    environment: envValue('ENROLLMENT_CANARY_ENVIRONMENT') ?? 'production',
    outputPath:
      envValue('ENROLLMENT_CANARY_OUTPUT', 'PRODUCTION_ENROLLMENT_CANARY_OUTPUT') ??
      DEFAULT_ENROLLMENT_CANARY_OUTPUT_PATH,
  });

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.result !== 'success') {
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
