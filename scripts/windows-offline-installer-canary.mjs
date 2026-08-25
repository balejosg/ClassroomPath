#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WINDOWS_OFFLINE_INSTALLER_CANARY_OUTPUT =
  'windows-offline-installer-canary.json';
export const DEFAULT_WINDOWS_OFFLINE_INSTALLER_REUSE_RETRY_DELAYS_MS = Object.freeze([
  0, 100, 250, 500,
]);
export const MAX_WINDOWS_OFFLINE_INSTALLER_REUSE_RETRY_WINDOW_MS = 2000;

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_EXE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/i;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeBaseUrl(value) {
  return required(value, 'WINDOWS_OFFLINE_INSTALLER_CANARY_BASE_URL').replace(/\/+$/, '');
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
 * @param {{ generated?: boolean, firstDownloadStatus?: number|null, reuseStatus?: number|null, reuseAttempts?: number, errorCode: string }} options
 */
function failedEvidence({
  generated = false,
  firstDownloadStatus = null,
  reuseStatus = null,
  reuseAttempts = 0,
  errorCode,
}) {
  return {
    result: 'failed',
    generated,
    firstDownloadStatus,
    reuseStatus,
    reuseAttempts,
    fileName: null,
    size: null,
    expectedSha256: null,
    actualSha256: null,
    shaMatches: false,
    attachment: false,
    errorCode,
  };
}

/**
 * Exercises only the ClassroomPath Windows offline-installer mutation and
 * its single-use download route. Evidence intentionally omits URLs, refs,
 * authorization, JWTs, and enrollment tokens.
 */
export async function runWindowsOfflineInstallerCanary({
  baseUrl,
  classroomId,
  accessToken,
  cookieHeader = '',
  outputPath = DEFAULT_WINDOWS_OFFLINE_INSTALLER_CANARY_OUTPUT,
  now = () => new Date(),
  fetchImpl = fetch,
  reuseRetryDelaysMs = DEFAULT_WINDOWS_OFFLINE_INSTALLER_REUSE_RETRY_DELAYS_MS,
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
  if (
    !Array.isArray(reuseRetryDelaysMs) ||
    reuseRetryDelaysMs.length === 0 ||
    reuseRetryDelaysMs.length > 4 ||
    reuseRetryDelaysMs.some((delay) => !Number.isInteger(delay) || delay < 0) ||
    reuseRetryDelaysMs.reduce((sum, delay) => sum + delay, 0) >
      MAX_WINDOWS_OFFLINE_INSTALLER_REUSE_RETRY_WINDOW_MS
  ) {
    throw new Error('reuse retry window must be short and bounded');
  }

  let generatedResponse;
  let generatedData;
  try {
    const generateHeaders = {
      'Content-Type': 'application/json',
    };
    if (normalizedCookieHeader) {
      generateHeaders.Cookie = normalizedCookieHeader;
    } else {
      generateHeaders.Authorization = `Bearer ${normalizedAccessToken}`;
    }
    generatedResponse = await fetchImpl(generateUrl, {
      method: 'POST',
      headers: generateHeaders,
      body: JSON.stringify({ json: { classroomId: normalizedClassroomId } }),
    });
    if (generatedResponse.status !== 200) {
      return writeEvidence(outputPath, failedEvidence({ errorCode: 'GENERATE_HTTP_ERROR' }));
    }
    generatedData = extractTrpcData(await generatedResponse.json());
    if (
      !generatedData ||
      typeof generatedData.downloadUrl !== 'string' ||
      typeof generatedData.fileName !== 'string' ||
      typeof generatedData.sha256 !== 'string'
    ) {
      return writeEvidence(outputPath, failedEvidence({ errorCode: 'GENERATE_CONTRACT_INVALID' }));
    }
  } catch {
    return writeEvidence(outputPath, failedEvidence({ errorCode: 'GENERATE_FAILED' }));
  }

  const downloadUrl = new URL(generatedData.downloadUrl, normalizedBaseUrl).toString();
  let firstDownloadResponse;
  let firstBytes = Buffer.alloc(0);
  /** @type {number|null} */
  let firstDownloadStatus = null;
  let attachment = false;
  try {
    firstDownloadResponse = await fetchImpl(downloadUrl);
    firstDownloadStatus = firstDownloadResponse.status;
    if (firstDownloadStatus !== 200) {
      return writeEvidence(
        outputPath,
        failedEvidence({
          generated: true,
          firstDownloadStatus,
          errorCode: 'FIRST_DOWNLOAD_HTTP_ERROR',
        })
      );
    }
    const contentDisposition = firstDownloadResponse.headers.get('content-disposition') ?? '';
    attachment = /^attachment\s*;\s*filename="[^"]+\.exe"$/i.test(contentDisposition);
    firstBytes = Buffer.from(await firstDownloadResponse.arrayBuffer());
  } catch {
    return writeEvidence(
      outputPath,
      failedEvidence({
        generated: true,
        firstDownloadStatus,
        errorCode: 'FIRST_DOWNLOAD_FAILED',
      })
    );
  }

  /** @type {number|null} */
  let reuseStatus = null;
  let reuseAttempts = 0;
  for (const delay of reuseRetryDelaysMs) {
    if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    reuseAttempts += 1;
    try {
      const reuseResponse = await fetchImpl(downloadUrl);
      reuseStatus = reuseResponse.status;
      if (reuseStatus === 410) break;
    } catch {
      return writeEvidence(
        outputPath,
        failedEvidence({
          generated: true,
          firstDownloadStatus,
          reuseStatus,
          reuseAttempts,
          errorCode: 'REUSE_DOWNLOAD_FAILED',
        })
      );
    }
  }

  const actualSha256 = firstBytes.length > 0 ? hashBytes(firstBytes) : null;
  const expectedSha256 = HEX_SHA256.test(generatedData.sha256) ? generatedData.sha256 : null;
  const shaMatches = actualSha256 === expectedSha256;
  const fileName = SAFE_EXE_FILE_NAME.test(generatedData.fileName) ? generatedData.fileName : null;
  const ok =
    firstDownloadStatus === 200 &&
    attachment &&
    fileName !== null &&
    firstBytes.length > 0 &&
    shaMatches &&
    reuseStatus === 410;

  return writeEvidence(outputPath, {
    result: ok ? 'success' : 'failed',
    generated: true,
    firstDownloadStatus,
    reuseStatus,
    reuseAttempts,
    fileName,
    size: firstBytes.length,
    expectedSha256,
    actualSha256,
    shaMatches,
    attachment,
    errorCode: ok ? null : 'DOWNLOAD_CONTRACT_FAILED',
    generatedAt: now().toISOString(),
  });
}

/** @returns {string|undefined} */
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
