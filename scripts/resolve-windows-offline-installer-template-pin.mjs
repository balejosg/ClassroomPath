#!/usr/bin/env node
// @ts-check

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const SHORT_COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_OFFLINE_INSTALLER_TEMPLATE_PIN_FIELDS = ['version', 'commit', 'releaseTag', 'sha256'];

export const WINDOWS_OFFLINE_INSTALLER_TEMPLATE_ASSET = 'OpenPath-Windows-Setup-Template.exe';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function validateWindowsOfflineInstallerTemplatePin(
  pin = {},
  { context = 'Windows offline installer pin' } = {}
) {
  const values = {
    version: String(pin?.version ?? '').trim(),
    commit: String(pin?.commit ?? '').trim(),
    releaseTag: String(pin?.releaseTag ?? '').trim(),
    sha256: String(pin?.sha256 ?? '').trim(),
  };
  const present = Object.values(values).filter(Boolean).length;

  if (present !== WINDOWS_OFFLINE_INSTALLER_TEMPLATE_PIN_FIELDS.length) {
    throw new Error(`${context} must contain the complete Windows offline installer pin`);
  }
  if (!SAFE_VERSION.test(values.version)) {
    throw new Error(`${context} version is invalid`);
  }
  if (!FULL_COMMIT_SHA.test(values.commit)) {
    throw new Error(`${context} commit must be a full lowercase SHA`);
  }

  const releaseTagMatch = values.releaseTag.match(/^scripts-v(.+)-([0-9a-f]{7,40})$/);
  if (
    !releaseTagMatch ||
    releaseTagMatch[1] !== values.version ||
    !values.commit.startsWith(releaseTagMatch[2])
  ) {
    throw new Error(`${context} release tag is invalid`);
  }
  if (!HEX_SHA256.test(values.sha256)) {
    throw new Error(`${context} sha256 is invalid`);
  }

  return values;
}

export function deriveWindowsOfflineInstallerTemplateRelease({
  version,
  commit,
  shortCommit = '',
}) {
  const normalizedVersion = required(version, 'OpenPath template version');
  const normalizedCommit = required(commit, 'OpenPath template commit');
  const normalizedShortCommit = String(shortCommit ?? '').trim() || normalizedCommit.slice(0, 7);
  if (!SAFE_VERSION.test(normalizedVersion)) {
    throw new Error('OpenPath template version is invalid');
  }
  if (!FULL_COMMIT_SHA.test(normalizedCommit)) {
    throw new Error('OpenPath template commit must be a full lowercase SHA');
  }
  if (
    !SHORT_COMMIT_SHA.test(normalizedShortCommit) ||
    !normalizedCommit.startsWith(normalizedShortCommit)
  ) {
    throw new Error('OpenPath template short commit is invalid');
  }

  const releaseTag = `scripts-v${normalizedVersion}-${normalizedShortCommit}`;
  return {
    version: normalizedVersion,
    commit: normalizedCommit,
    shortCommit: normalizedShortCommit,
    releaseTag,
    sidecarUrl: `https://github.com/balejosg/openpath/releases/download/${encodeURIComponent(
      releaseTag
    )}/${WINDOWS_OFFLINE_INSTALLER_TEMPLATE_ASSET}.sha256`,
  };
}

export function parseWindowsOfflineInstallerTemplateSidecar(sidecarText) {
  const digest = String(sidecarText ?? '')
    .trim()
    .split(/\s+/)[0];
  if (!HEX_SHA256.test(digest)) {
    throw new Error('OpenPath template sidecar is malformed');
  }
  return digest;
}

export async function resolveWindowsOfflineInstallerTemplatePin({
  version,
  commit,
  shortCommit = '',
  fetchImpl = globalThis.fetch,
}) {
  const release = deriveWindowsOfflineInstallerTemplateRelease({ version, commit, shortCommit });
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');

  let response;
  try {
    response = await fetchImpl(release.sidecarUrl);
  } catch {
    throw new Error('OpenPath template sidecar download failed');
  }
  if (!response.ok) throw new Error('OpenPath template sidecar download failed');

  let sidecarText;
  try {
    sidecarText = await response.text();
  } catch {
    throw new Error('OpenPath template sidecar could not be read');
  }

  const sha256 = parseWindowsOfflineInstallerTemplateSidecar(sidecarText);
  validateWindowsOfflineInstallerTemplatePin(
    {
      version: release.version,
      commit: release.commit,
      releaseTag: release.releaseTag,
      sha256,
    },
    { context: 'Resolved Windows offline installer pin' }
  );

  return {
    ...release,
    sha256,
  };
}

function writePin(pin) {
  process.stdout.write(
    [
      `template_version=${pin.version}`,
      `template_commit=${pin.commit}`,
      `template_release_tag=${pin.releaseTag}`,
      `template_sha256=${pin.sha256}`,
    ].join('\n') + '\n'
  );
}

async function main() {
  const promotionContractCommit = process.env.OPENPATH_SHA?.trim() ?? '';
  if (promotionContractCommit) {
    writePin(
      await resolveWindowsOfflineInstallerTemplatePin({
        version: process.env.OPENPATH_VERSION?.trim(),
        commit: promotionContractCommit,
        shortCommit: process.env.OPENPATH_SHORT_SHA?.trim(),
      })
    );
    return;
  }

  writePin(
    validateWindowsOfflineInstallerTemplatePin(
      {
        version: process.env.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION,
        commit: process.env.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT,
        releaseTag: process.env.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG,
        sha256: process.env.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256,
      },
      { context: 'contract-derived Windows offline installer pin' }
    )
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'template pin resolution failed'}\n`
    );
    process.exitCode = 1;
  });
}
