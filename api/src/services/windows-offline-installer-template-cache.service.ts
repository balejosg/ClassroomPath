import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface CachedTemplate {
  filePath: string;
  version: string;
  commit: string;
  sha256: string;
}

export class WindowsOfflineTemplateCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindowsOfflineTemplateCacheError';
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Loads the pinned template from the cache directory. The cache layout is
 * `<cacheDir>/<version>/<commit>/OpenPath-Windows-Setup-Template.exe`; an
 * absent, stale (commit mismatch), or hash-mismatched asset fails closed
 * instead of falling back to an unknown template version.
 */
export function loadCachedWindowsOfflineTemplate(
  cacheDir: string,
  expected: { version: string; commit: string; sha256: string }
): CachedTemplate {
  const templateDir = path.join(cacheDir, expected.version, expected.commit);
  const templatePath = path.join(templateDir, 'OpenPath-Windows-Setup-Template.exe');

  if (!existsSync(templatePath)) {
    throw new WindowsOfflineTemplateCacheError(
      `Cached OpenPath Windows setup template not found for version ${expected.version} (${expected.commit})`
    );
  }

  const sidecarPath = `${templatePath}.sha256`;
  if (!existsSync(sidecarPath)) {
    throw new WindowsOfflineTemplateCacheError(
      'Cached template is missing its .sha256 sidecar; refusing to use an unverifiable asset'
    );
  }

  const sidecarDigest = readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0]?.toLowerCase();
  if (!sidecarDigest || !HEX_SHA256.test(sidecarDigest)) {
    throw new WindowsOfflineTemplateCacheError('Template .sha256 sidecar is malformed');
  }

  if (sidecarDigest !== expected.sha256) {
    throw new WindowsOfflineTemplateCacheError(
      `Cached template sidecar does not match the pinned release digest`
    );
  }

  const actualDigest = sha256File(templatePath);
  if (actualDigest !== expected.sha256) {
    throw new WindowsOfflineTemplateCacheError(
      'Cached template bytes do not match the pinned release SHA-256'
    );
  }

  return {
    filePath: templatePath,
    version: expected.version,
    commit: expected.commit,
    sha256: actualDigest,
  };
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;
