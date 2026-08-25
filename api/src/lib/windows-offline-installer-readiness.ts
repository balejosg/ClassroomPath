import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  loadWindowsOfflineInstallerConfig,
  type WindowsOfflineInstallerConfig,
} from './windows-offline-installer-config.js';
import {
  WindowsOfflineTemplateCacheError,
  loadCachedWindowsOfflineTemplate,
  type WindowsOfflineTemplateReadFile,
} from '../services/windows-offline-installer-template-cache.service.js';

export type WindowsOfflineInstallerReadinessCode =
  | 'OK'
  | 'CONFIG_INVALID'
  | 'TEMPLATE_MISSING'
  | 'SIDECAR_MISSING'
  | 'SIDECAR_INVALID'
  | 'SIDECAR_HASH_MISMATCH'
  | 'TEMPLATE_HASH_MISMATCH'
  | 'ARTIFACTS_DIR_UNAVAILABLE'
  | 'ARTIFACTS_DIR_NOT_WRITABLE';

export interface WindowsOfflineInstallerReadiness {
  ready: boolean;
  code: WindowsOfflineInstallerReadinessCode;
}

export interface WindowsOfflineInstallerReadinessOptions {
  env?: Readonly<Record<string, string | undefined>>;
  probeArtifactsWrite?: (artifactsDir: string) => void;
  readTemplateFile?: WindowsOfflineTemplateReadFile;
  hashTemplateFile?: (filePath: string) => string;
  statTemplateFile?: (filePath: string) => {
    size: number;
    mtimeMs: number;
    ctimeMs?: number;
    ino?: number;
  };
}

const templateReadinessCache = new Map<string, WindowsOfflineInstallerReadiness>();

export function resetWindowsOfflineInstallerReadinessCache(): void {
  templateReadinessCache.clear();
}

function defaultProbeArtifactsWrite(artifactsDir: string): void {
  const probePath = path.join(artifactsDir, `.cp-readiness-${process.pid}-${randomUUID()}`);
  try {
    writeFileSync(probePath, 'ok', { flag: 'wx' });
  } finally {
    rmSync(probePath, { force: true });
  }
}

function mapTemplateError(
  error: WindowsOfflineTemplateCacheError
): WindowsOfflineInstallerReadinessCode {
  return error.code;
}

function ready(): WindowsOfflineInstallerReadiness {
  return { ready: true, code: 'OK' };
}

function notReady(code: WindowsOfflineInstallerReadinessCode): WindowsOfflineInstallerReadiness {
  return { ready: false, code };
}

function checkArtifactsDirectory(
  config: WindowsOfflineInstallerConfig,
  probeArtifactsWrite: (artifactsDir: string) => void
): WindowsOfflineInstallerReadiness {
  if (!existsSync(config.artifactsDir)) return notReady('ARTIFACTS_DIR_UNAVAILABLE');

  try {
    if (!statSync(config.artifactsDir).isDirectory()) {
      return notReady('ARTIFACTS_DIR_UNAVAILABLE');
    }
  } catch {
    return notReady('ARTIFACTS_DIR_UNAVAILABLE');
  }

  try {
    probeArtifactsWrite(config.artifactsDir);
  } catch {
    return notReady('ARTIFACTS_DIR_NOT_WRITABLE');
  }

  return ready();
}

function fileIdentity(
  filePath: string,
  statTemplateFile: (filePath: string) => {
    size: number;
    mtimeMs: number;
    ctimeMs?: number;
    ino?: number;
  }
): string | null {
  try {
    const stat = statTemplateFile(filePath);
    return [filePath, stat.size, stat.mtimeMs, stat.ctimeMs ?? '', stat.ino ?? ''].join(':');
  } catch {
    return null;
  }
}

function checkTemplateWithCache(
  config: WindowsOfflineInstallerConfig,
  options: WindowsOfflineInstallerReadinessOptions
): WindowsOfflineInstallerReadiness {
  const statTemplateFile = options.statTemplateFile ?? statSync;
  const templatePath = path.join(
    config.templateDir,
    config.templateVersion,
    config.templateCommit,
    'OpenPath-Windows-Setup-Template.exe'
  );
  const sidecarPath = `${templatePath}.sha256`;
  const templateIdentity = fileIdentity(templatePath, statTemplateFile);
  const sidecarIdentity = fileIdentity(sidecarPath, statTemplateFile);
  const cacheKey =
    templateIdentity && sidecarIdentity
      ? [templateIdentity, sidecarIdentity, config.templateSha256].join('|')
      : null;

  if (cacheKey) {
    const cached = templateReadinessCache.get(cacheKey);
    if (cached) return cached;
  }

  let result: WindowsOfflineInstallerReadiness;
  try {
    loadCachedWindowsOfflineTemplate(
      config.templateDir,
      {
        version: config.templateVersion,
        commit: config.templateCommit,
        sha256: config.templateSha256,
      },
      {
        readFile: options.readTemplateFile,
        hashFile: options.hashTemplateFile,
      }
    );
    result = ready();
  } catch (error) {
    if (error instanceof WindowsOfflineTemplateCacheError) {
      result = notReady(mapTemplateError(error));
    } else {
      result = notReady('TEMPLATE_MISSING');
    }
  }

  // Cache only a verified healthy identity. A broken template is intentionally
  // re-read on the next probe so a repair/reprovision becomes visible even on
  // filesystems with coarse timestamp resolution.
  if (cacheKey && result.ready) templateReadinessCache.set(cacheKey, result);
  return result;
}

/**
 * Checks only local filesystem/config state. Deliberately contains no fetch,
 * GitHub, provisioning, repair, or directory creation logic.
 */
export function checkWindowsOfflineInstallerReadiness(
  options: WindowsOfflineInstallerReadinessOptions = {}
): WindowsOfflineInstallerReadiness {
  let config: WindowsOfflineInstallerConfig;
  try {
    config = loadWindowsOfflineInstallerConfig(options.env);
  } catch {
    return notReady('CONFIG_INVALID');
  }

  const templateResult = checkTemplateWithCache(config, options);
  if (!templateResult.ready) return templateResult;

  return checkArtifactsDirectory(config, options.probeArtifactsWrite ?? defaultProbeArtifactsWrite);
}
