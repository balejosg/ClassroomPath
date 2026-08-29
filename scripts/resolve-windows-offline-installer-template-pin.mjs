#!/usr/bin/env node
// @ts-check

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const WINDOWS_OFFLINE_INSTALLER_TEMPLATE_ASSET = 'OpenPath-Windows-Setup-Template.exe';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function deriveWindowsOfflineInstallerTemplateRelease({ version, commit }) {
  const normalizedVersion = required(version, 'OpenPath template version');
  const normalizedCommit = required(commit, 'OpenPath template commit');
  if (!SAFE_VERSION.test(normalizedVersion)) {
    throw new Error('OpenPath template version is invalid');
  }
  if (!FULL_COMMIT_SHA.test(normalizedCommit)) {
    throw new Error('OpenPath template commit must be a full lowercase SHA');
  }

  const releaseTag = `scripts-v${normalizedVersion}-${normalizedCommit.slice(0, 7)}`;
  return {
    version: normalizedVersion,
    commit: normalizedCommit,
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
  fetchImpl = globalThis.fetch,
}) {
  const release = deriveWindowsOfflineInstallerTemplateRelease({ version, commit });
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

  return {
    ...release,
    sha256: parseWindowsOfflineInstallerTemplateSidecar(sidecarText),
  };
}

async function main() {
  const pin = await resolveWindowsOfflineInstallerTemplatePin({
    version: process.env.OPENPATH_VERSION?.trim(),
    commit: process.env.OPENPATH_SHA?.trim(),
  });
  process.stdout.write(
    [
      `template_version=${pin.version}`,
      `template_commit=${pin.commit}`,
      `template_release_tag=${pin.releaseTag}`,
      `template_sha256=${pin.sha256}`,
    ].join('\n') + '\n'
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
