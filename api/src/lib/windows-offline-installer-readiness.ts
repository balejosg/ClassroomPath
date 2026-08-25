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

  try {
    loadCachedWindowsOfflineTemplate(config.templateDir, {
      version: config.templateVersion,
      commit: config.templateCommit,
      sha256: config.templateSha256,
    });
  } catch (error) {
    if (error instanceof WindowsOfflineTemplateCacheError) {
      return notReady(mapTemplateError(error));
    }
    return notReady('TEMPLATE_MISSING');
  }

  return checkArtifactsDirectory(config, options.probeArtifactsWrite ?? defaultProbeArtifactsWrite);
}
