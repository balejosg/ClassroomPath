import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface CachedTemplate {
  filePath: string;
  version: string;
  commit: string;
  sha256: string;
}

export type WindowsOfflineTemplateCacheErrorCode =
  | 'TEMPLATE_MISSING'
  | 'SIDECAR_MISSING'
  | 'SIDECAR_INVALID'
  | 'SIDECAR_HASH_MISMATCH'
  | 'TEMPLATE_HASH_MISMATCH';

export class WindowsOfflineTemplateCacheError extends Error {
  readonly code: WindowsOfflineTemplateCacheErrorCode;

  constructor(code: WindowsOfflineTemplateCacheErrorCode, message: string) {
    super(message);
    this.name = 'WindowsOfflineTemplateCacheError';
    this.code = code;
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Loads the pinned template from the read-only template directory. The layout is
 * `<templateDir>/<version>/<commit>/OpenPath-Windows-Setup-Template.exe`; an
 * absent, stale (commit mismatch), or hash-mismatched asset fails closed
 * instead of falling back to an unknown template version.
 */
export function loadCachedWindowsOfflineTemplate(
  templateDir: string,
  expected: { version: string; commit: string; sha256: string }
): CachedTemplate {
  const expectedTemplateDir = path.join(templateDir, expected.version, expected.commit);
  const templatePath = path.join(expectedTemplateDir, 'OpenPath-Windows-Setup-Template.exe');

  if (!existsSync(templatePath)) {
    throw new WindowsOfflineTemplateCacheError(
      'TEMPLATE_MISSING',
      `Cached OpenPath Windows setup template not found for version ${expected.version} (${expected.commit})`
    );
  }

  const sidecarPath = `${templatePath}.sha256`;
  if (!existsSync(sidecarPath)) {
    throw new WindowsOfflineTemplateCacheError(
      'SIDECAR_MISSING',
      'Cached template is missing its .sha256 sidecar; refusing to use an unverifiable asset'
    );
  }

  const sidecarDigest = readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0];
  if (!sidecarDigest || !HEX_SHA256.test(sidecarDigest)) {
    throw new WindowsOfflineTemplateCacheError(
      'SIDECAR_INVALID',
      'Template .sha256 sidecar is malformed'
    );
  }

  if (sidecarDigest !== expected.sha256) {
    throw new WindowsOfflineTemplateCacheError(
      'SIDECAR_HASH_MISMATCH',
      `Cached template sidecar does not match the pinned release digest`
    );
  }

  const actualDigest = sha256File(templatePath);
  if (actualDigest !== expected.sha256) {
    throw new WindowsOfflineTemplateCacheError(
      'TEMPLATE_HASH_MISMATCH',
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
