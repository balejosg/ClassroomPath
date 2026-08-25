#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWindowsOfflineInstallerTemplateDestination as resolveTemplateDestination } from './lib/windows-offline-installer-template-path.mjs';

const EXE_NAME = 'OpenPath-Windows-Setup-Template.exe';
const SIDECAR_NAME = `${EXE_NAME}.sha256`;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class WindowsOfflineInstallerTemplateProvisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WindowsOfflineInstallerTemplateProvisionError';
    this.code = code;
  }
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'CONFIG_INVALID',
      `${name} is required`
    );
  }
  return value;
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateWindowsOfflineInstallerTemplatePin({
  version,
  commit,
  releaseTag,
  sha256,
}) {
  if (!SAFE_VERSION.test(version)) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'CONFIG_INVALID',
      'template version must be a safe release version'
    );
  }
  if (!FULL_COMMIT_SHA.test(commit)) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'CONFIG_INVALID',
      'template commit must be a full 40-character lowercase SHA'
    );
  }
  if (!HEX_SHA256.test(sha256)) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'CONFIG_INVALID',
      'template SHA-256 must be a lowercase 64-character hex digest'
    );
  }

  const tagPrefix = `scripts-v${version}-`;
  const tagMatch = releaseTag.match(new RegExp(`^${escapedRegExp(tagPrefix)}([0-9a-f]{7,40})$`));
  if (!tagMatch) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'RELEASE_TAG_INVALID',
      `release tag must start with ${tagPrefix} and contain a hexadecimal short SHA`
    );
  }
  if (!commit.startsWith(tagMatch[1])) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'RELEASE_TAG_COMMIT_MISMATCH',
      'release tag short SHA must prefix the configured full commit'
    );
  }

  return { version, commit, releaseTag, sha256 };
}

export function readWindowsOfflineInstallerTemplatePin(env = process.env) {
  const version = required(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_VERSION');
  const commit = required(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT');
  const releaseTag = required(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG');
  const sha256 = required(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_SHA256');
  return validateWindowsOfflineInstallerTemplatePin({ version, commit, releaseTag, sha256 });
}

export function resolveWindowsOfflineInstallerTemplateDestination(
  env = process.env,
  cwd = process.cwd()
) {
  return resolveTemplateDestination(env, cwd);
}

export function resolveWindowsOfflineInstallerTemplateAssetUrls(releaseTag) {
  const base = `https://github.com/balejosg/openpath/releases/download/${encodeURIComponent(releaseTag)}`;
  return {
    exe: `${base}/${EXE_NAME}`,
    sidecar: `${base}/${SIDECAR_NAME}`,
  };
}

function getPaths(root, pin) {
  const directory = path.join(root, pin.version, pin.commit);
  const exePath = path.join(directory, EXE_NAME);
  return { directory, exePath, sidecarPath: path.join(directory, SIDECAR_NAME) };
}

function parseSidecar(sidecarBytes) {
  const digest = sidecarBytes.toString('utf8').trim().split(/\s+/)[0];
  if (!digest || !HEX_SHA256.test(digest)) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'SIDECAR_INVALID',
      'template sidecar is malformed'
    );
  }
  return digest;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyFiles(paths, pin) {
  if (!existsSync(paths.exePath)) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'TEMPLATE_MISSING',
      'provisioned template executable is missing'
    );
  }
  if (!existsSync(paths.sidecarPath)) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'SIDECAR_MISSING',
      'provisioned template sidecar is missing'
    );
  }

  const sidecarDigest = parseSidecar(readFileSync(paths.sidecarPath));
  if (sidecarDigest !== pin.sha256) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'SIDECAR_HASH_MISMATCH',
      'provisioned template sidecar does not match configured SHA-256'
    );
  }

  const actualDigest = hashBytes(readFileSync(paths.exePath));
  if (actualDigest !== pin.sha256) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'TEMPLATE_HASH_MISMATCH',
      'provisioned template executable bytes do not match configured SHA-256'
    );
  }
}

function normalizePublishedTemplatePermissions(root, paths) {
  const versionDirectory = path.dirname(paths.directory);
  mkdirSync(versionDirectory, { recursive: true, mode: 0o755 });
  chmodSync(root, 0o755);
  chmodSync(versionDirectory, 0o755);
  chmodSync(paths.directory, 0o755);
  chmodSync(paths.exePath, 0o644);
  chmodSync(paths.sidecarPath, 0o644);
}

async function downloadAsset(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'ASSET_DOWNLOAD_FAILED',
      'asset download failed'
    );
  }
  if (!response.ok) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'ASSET_DOWNLOAD_FAILED',
      `asset download failed with HTTP ${response.status}`
    );
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'ASSET_DOWNLOAD_FAILED',
      'asset response body could not be read'
    );
  }
}

function assertDownloadedAssets(exeBytes, sidecarBytes, pin) {
  const sidecarDigest = parseSidecar(sidecarBytes);
  if (sidecarDigest !== pin.sha256) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'SIDECAR_HASH_MISMATCH',
      'downloaded template sidecar does not match configured SHA-256'
    );
  }
  if (hashBytes(exeBytes) !== pin.sha256) {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'TEMPLATE_HASH_MISMATCH',
      'downloaded executable bytes do not match configured SHA-256'
    );
  }
}

export async function verifyWindowsOfflineInstallerTemplate({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const pin = readWindowsOfflineInstallerTemplatePin(env);
  const destinationRoot = resolveWindowsOfflineInstallerTemplateDestination(env, cwd);
  const paths = getPaths(destinationRoot, pin);
  verifyFiles(paths, pin);
  return { status: 'valid', directory: paths.directory };
}

export async function provisionWindowsOfflineInstallerTemplate({
  env = process.env,
  fetchImpl = globalThis.fetch,
  cwd = process.cwd(),
} = {}) {
  const pin = readWindowsOfflineInstallerTemplatePin(env);
  const destinationRoot = resolveWindowsOfflineInstallerTemplateDestination(env, cwd);
  const paths = getPaths(destinationRoot, pin);

  try {
    verifyFiles(paths, pin);
    normalizePublishedTemplatePermissions(destinationRoot, paths);
    return { status: 'already_valid', directory: paths.directory };
  } catch (error) {
    if (!(error instanceof WindowsOfflineInstallerTemplateProvisionError)) throw error;
    if (
      error.code === 'CONFIG_INVALID' ||
      error.code === 'RELEASE_TAG_INVALID' ||
      error.code === 'RELEASE_TAG_COMMIT_MISMATCH'
    ) {
      throw error;
    }
  }

  if (typeof fetchImpl !== 'function') {
    throw new WindowsOfflineInstallerTemplateProvisionError(
      'ASSET_DOWNLOAD_FAILED',
      'fetch implementation is unavailable'
    );
  }

  const urls = resolveWindowsOfflineInstallerTemplateAssetUrls(pin.releaseTag);
  let exeBytes;
  let sidecarBytes;
  exeBytes = await downloadAsset(fetchImpl, urls.exe);
  sidecarBytes = await downloadAsset(fetchImpl, urls.sidecar);
  assertDownloadedAssets(exeBytes, sidecarBytes, pin);

  const parent = path.dirname(paths.directory);
  mkdirSync(destinationRoot, { recursive: true, mode: 0o755 });
  mkdirSync(parent, { recursive: true, mode: 0o755 });
  chmodSync(destinationRoot, 0o755);
  chmodSync(parent, 0o755);
  const temporaryDirectory = mkdtempSync(path.join(parent, `.cp-template-${process.pid}-`));
  const temporaryExePath = path.join(temporaryDirectory, EXE_NAME);
  const temporarySidecarPath = path.join(temporaryDirectory, SIDECAR_NAME);
  const backupDirectory = `${paths.directory}.backup-${process.pid}-${Date.now().toString(36)}`;
  let movedExistingDirectory = false;
  try {
    writeFileSync(temporaryExePath, exeBytes, { flag: 'wx', mode: 0o644 });
    writeFileSync(temporarySidecarPath, sidecarBytes, { flag: 'wx', mode: 0o644 });
    chmodSync(temporaryDirectory, 0o755);
    chmodSync(temporaryExePath, 0o644);
    chmodSync(temporarySidecarPath, 0o644);
    if (existsSync(paths.directory)) {
      renameSync(paths.directory, backupDirectory);
      movedExistingDirectory = true;
    }
    renameSync(temporaryDirectory, paths.directory);
  } catch (error) {
    if (movedExistingDirectory && !existsSync(paths.directory)) {
      renameSync(backupDirectory, paths.directory);
      movedExistingDirectory = false;
    }
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    if (movedExistingDirectory) {
      rmSync(backupDirectory, { recursive: true, force: true });
    }
  }

  verifyFiles(paths, pin);
  return { status: 'provisioned', directory: paths.directory };
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  const result = verifyOnly
    ? await verifyWindowsOfflineInstallerTemplate()
    : await provisionWindowsOfflineInstallerTemplate();
  process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof WindowsOfflineInstallerTemplateProvisionError ? error.message : 'template provisioning failed'}\n`
    );
    process.exitCode = 1;
  });
}

export { EXE_NAME, SIDECAR_NAME };
