#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WINDOWS_OFFLINE_INSTALLER_CANARY_OUTPUT =
  'windows-offline-installer-canary.json';

const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_EXE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/iu;
const CANONICAL_DOWNLOAD_PATH = '/api/windows-offline-installer/download';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeBaseUrl(value) {
  return required(value, 'WINDOWS_OFFLINE_INSTALLER_CANARY_BASE_URL').replace(/\/+$/u, '');
}

function extractTrpcData(payload) {
  const envelope = Array.isArray(payload) ? payload[0] : payload;
  const data = envelope?.result?.data;
  if (data && typeof data === 'object' && 'json' in data) return data.json;
  return data;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeEvidence(outputPath, evidence) {
  writeFileSync(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

/**
 * @param {{ generated?: boolean; downloadStatus?: number | null; errorCode: string }} input
 */
function failedEvidence({ generated = false, downloadStatus = null, errorCode }) {
  return {
    result: 'failed',
    generated,
    downloadStatus,
    fileName: null,
    size: null,
    contentLength: null,
    contentLengthMatches: false,
    expectedSha256: null,
    actualSha256: null,
    shaMatches: false,
    attachment: false,
    canonicalPath: false,
    errorCode,
  };
}

function parseCanonicalDownloadUrl(downloadUrl, baseUrl) {
  let parsed;
  try {
    parsed = new URL(downloadUrl, baseUrl);
  } catch {
    return null;
  }

  const base = new URL(baseUrl);
  if (
    parsed.origin !== base.origin ||
    parsed.pathname !== CANONICAL_DOWNLOAD_PATH ||
    !parsed.searchParams.get('ref')
  ) {
    return null;
  }

  return parsed;
}

function validateGeneratedMetadata(data, baseUrl) {
  if (!data || typeof data !== 'object') return null;

  const fileName = typeof data.fileName === 'string' ? data.fileName : '';
  const version = typeof data.version === 'string' ? data.version : '';
  const sha256 = typeof data.sha256 === 'string' ? data.sha256 : '';
  const tokenExpiresAt = typeof data.tokenExpiresAt === 'string' ? data.tokenExpiresAt : '';
  const downloadExpiresAt =
    typeof data.downloadExpiresAt === 'string' ? data.downloadExpiresAt : '';
  const downloadUrl = typeof data.downloadUrl === 'string' ? data.downloadUrl : '';
  const canonicalUrl = parseCanonicalDownloadUrl(downloadUrl, baseUrl);

  if (
    !SAFE_EXE_FILE_NAME.test(fileName) ||
    !version ||
    !HEX_SHA256.test(sha256) ||
    !tokenExpiresAt ||
    !downloadExpiresAt ||
    !canonicalUrl
  ) {
    return null;
  }

  return { fileName, sha256, canonicalUrl };
}

/**
 * Exercises only the ClassroomPath boundary and the canonical OpenPath
 * download. OpenPath owns the single-use replay proof; this canary checks the
 * wrapper's session/policy/gateway path, attachment headers, length, and bytes.
 * Evidence intentionally omits URLs, refs, authorization, JWTs, cookies, and
 * enrollment/personalized payloads.
 */
export async function runWindowsOfflineInstallerCanary({
  baseUrl,
  classroomId,
  accessToken,
  cookieHeader = '',
  outputPath = DEFAULT_WINDOWS_OFFLINE_INSTALLER_CANARY_OUTPUT,
  now = () => new Date(),
  fetchImpl = fetch,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedClassroomId = required(
    classroomId,
    'WINDOWS_OFFLINE_INSTALLER_CANARY_CLASSROOM_ID'
  );
  const normalizedAccessToken = accessToken ? String(accessToken).trim() : '';
  const normalizedCookieHeader = cookieHeader ? String(cookieHeader).trim() : '';
  if (!normalizedAccessToken && !normalizedCookieHeader) {
    throw new Error(
      'WINDOWS_OFFLINE_INSTALLER_CANARY_ACCESS_TOKEN or WINDOWS_OFFLINE_INSTALLER_CANARY_COOKIE is required'
    );
  }

  const generateUrl = `${normalizedBaseUrl}/cp/trpc/windowsOfflineInstaller.generate`;
  let generatedResponse;
  let generatedData;
  try {
    const generateHeaders = { 'Content-Type': 'application/json' };
    if (normalizedCookieHeader) {
      generateHeaders.Cookie = normalizedCookieHeader;
    } else {
      generateHeaders.Authorization = `Bearer ${normalizedAccessToken}`;
    }
    generatedResponse = await fetchImpl(generateUrl, {
      method: 'POST',
      headers: generateHeaders,
      body: JSON.stringify({ classroomId: normalizedClassroomId }),
    });
    if (generatedResponse.status !== 200) {
      return writeEvidence(outputPath, failedEvidence({ errorCode: 'GENERATE_HTTP_ERROR' }));
    }
    generatedData = validateGeneratedMetadata(
      extractTrpcData(await generatedResponse.json()),
      normalizedBaseUrl
    );
    if (!generatedData) {
      return writeEvidence(outputPath, failedEvidence({ errorCode: 'GENERATE_CONTRACT_INVALID' }));
    }
  } catch {
    return writeEvidence(outputPath, failedEvidence({ errorCode: 'GENERATE_FAILED' }));
  }

  let downloadStatus = null;
  let downloadBytes = Buffer.alloc(0);
  let contentLength = null;
  let attachment = false;
  try {
    const downloadResponse = await fetchImpl(generatedData.canonicalUrl.toString());
    downloadStatus = downloadResponse.status;
    if (downloadStatus !== 200) {
      return writeEvidence(
        outputPath,
        failedEvidence({ generated: true, downloadStatus, errorCode: 'DOWNLOAD_HTTP_ERROR' })
      );
    }

    const contentDisposition = downloadResponse.headers.get('content-disposition') ?? '';
    attachment = /^attachment\s*;\s*filename="[^"]+\.exe"$/iu.test(contentDisposition);
    const rawContentLength = downloadResponse.headers.get('content-length');
    contentLength =
      rawContentLength && /^\d+$/u.test(rawContentLength)
        ? Number.parseInt(rawContentLength, 10)
        : null;
    downloadBytes = Buffer.from(await downloadResponse.arrayBuffer());
  } catch {
    return writeEvidence(
      outputPath,
      failedEvidence({ generated: true, downloadStatus, errorCode: 'DOWNLOAD_FAILED' })
    );
  }

  const actualSha256 = downloadBytes.length > 0 ? hashBytes(downloadBytes) : null;
  const contentLengthMatches = contentLength === downloadBytes.length;
  const shaMatches = actualSha256 === generatedData.sha256;
  const ok =
    downloadStatus === 200 &&
    attachment &&
    downloadBytes.length > 0 &&
    contentLengthMatches &&
    shaMatches;

  return writeEvidence(outputPath, {
    result: ok ? 'success' : 'failed',
    generated: true,
    downloadStatus,
    fileName: generatedData.fileName,
    size: downloadBytes.length,
    contentLength,
    contentLengthMatches,
    expectedSha256: generatedData.sha256,
    actualSha256,
    shaMatches,
    attachment,
    canonicalPath: true,
    errorCode: ok ? null : 'DOWNLOAD_CONTRACT_FAILED',
    generatedAt: now().toISOString(),
  });
}

function envValue(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

async function main() {
  const evidence = await runWindowsOfflineInstallerCanary({
    baseUrl: envValue('WINDOWS_OFFLINE_INSTALLER_CANARY_BASE_URL'),
    classroomId: envValue('WINDOWS_OFFLINE_INSTALLER_CANARY_CLASSROOM_ID'),
    accessToken: envValue('WINDOWS_OFFLINE_INSTALLER_CANARY_ACCESS_TOKEN'),
    cookieHeader: envValue('WINDOWS_OFFLINE_INSTALLER_CANARY_COOKIE'),
    outputPath:
      envValue('WINDOWS_OFFLINE_INSTALLER_CANARY_OUTPUT') ??
      DEFAULT_WINDOWS_OFFLINE_INSTALLER_CANARY_OUTPUT,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.result !== 'success') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'canary failed'}\n`);
    process.exitCode = 1;
  });
}
