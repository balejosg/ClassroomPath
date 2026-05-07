#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_OUTPUT_PATH = 'production-enrollment-download-canary.json';

function normalizeBaseUrl(baseUrl) {
  const normalized = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('Production enrollment canary base URL is required');
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

function contentLength(content) {
  return Buffer.byteLength(String(content ?? ''), 'utf8');
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

function windowsMarkerChecks(content) {
  const script = String(content ?? '');
  return {
    hasBootstrapManifestPath: script.includes('api/agent/windows/bootstrap/manifest'),
    hasOpenPathVersionEnv: script.includes('$env:OPENPATH_VERSION'),
    hasInstallScriptReference: script.includes('Install-OpenPath.ps1'),
  };
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

export async function runProductionEnrollmentDownloadCanary({
  baseUrl,
  classroomId,
  enrollmentToken,
  expectedLinuxAgentVersion = '',
  outputPath = DEFAULT_OUTPUT_PATH,
  now = () => new Date(),
  fetchImpl = fetch,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedClassroomId = encodeURIComponent(requireValue(classroomId, 'CLASSROOM_ID'));
  const normalizedEnrollmentToken = requireValue(enrollmentToken, 'ENROLLMENT_TOKEN');
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

  const linuxChecks = linuxMarkerChecks(linux.body, expectedLinuxAgentVersion);
  const windowsChecks = windowsMarkerChecks(windows.body);
  const evidence = {
    generatedAt: now().toISOString(),
    environment: 'production',
    baseUrl: normalizedBaseUrl,
    linux: {
      url: linuxUrl,
      status: linux.status,
      contentLength: contentLength(linux.body),
      ok: linux.status === 200 && contentLength(linux.body) > 0 && allChecksPass(linuxChecks),
      markerChecks: linuxChecks,
      failurePreview: boundedFailurePreview(linux.status, linux.body),
    },
    windows: {
      url: windowsUrl,
      status: windows.status,
      contentLength: contentLength(windows.body),
      ok: windows.status === 200 && contentLength(windows.body) > 0 && allChecksPass(windowsChecks),
      markerChecks: windowsChecks,
      failurePreview: boundedFailurePreview(windows.status, windows.body),
    },
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    workflowSha: process.env.GITHUB_SHA || null,
  };

  writeFileSync(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

async function main() {
  const evidence = await runProductionEnrollmentDownloadCanary({
    baseUrl: process.env.PRODUCTION_ENROLLMENT_CANARY_BASE_URL,
    classroomId: process.env.CLASSROOM_ID,
    enrollmentToken: process.env.ENROLLMENT_TOKEN,
    expectedLinuxAgentVersion: process.env.OPENPATH_LINUX_AGENT_VERSION,
    outputPath: process.env.PRODUCTION_ENROLLMENT_CANARY_OUTPUT || DEFAULT_OUTPUT_PATH,
  });

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.linux.ok || !evidence.windows.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
