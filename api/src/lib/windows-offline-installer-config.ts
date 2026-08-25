import path from 'node:path';

export interface WindowsOfflineInstallerConfig {
  tokenTtlHours: number;
  downloadRefTtlMinutes: number;
  downloadRefMaxAttempts: number;
  templateVersion: string;
  templateCommit: string;
  templateSha256: string;
  templateDir: string;
  artifactsDir: string;
  openpathUrl: string;
}

export class WindowsOfflineInstallerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindowsOfflineInstallerConfigError';
  }
}

function readPositiveIntEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number
): number {
  const raw = env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number.parseInt(raw, 10) <= 0) {
    throw new WindowsOfflineInstallerConfigError(`${name} must be a positive integer`);
  }
  return Number.parseInt(raw, 10);
}

function readRequiredEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const raw = env[name]?.trim();
  if (!raw) {
    throw new WindowsOfflineInstallerConfigError(`${name} is required`);
  }
  return raw;
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const TEMPLATE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function resolveConfiguredStorageDirectories(env: Readonly<Record<string, string | undefined>>): {
  templateDir: string;
  artifactsDir: string;
} {
  const templateDir = env.CP_OFFLINE_INSTALLER_TEMPLATE_DIR?.trim();
  const artifactsDir = env.CP_OFFLINE_INSTALLER_ARTIFACTS_DIR?.trim();
  const legacyCacheDir = env.CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR?.trim();

  if (!templateDir && !artifactsDir && legacyCacheDir) {
    return {
      templateDir: path.resolve(legacyCacheDir),
      artifactsDir: path.resolve(legacyCacheDir, 'artifacts'),
    };
  }

  if (!templateDir || !artifactsDir) {
    throw new WindowsOfflineInstallerConfigError(
      'CP_OFFLINE_INSTALLER_TEMPLATE_DIR and CP_OFFLINE_INSTALLER_ARTIFACTS_DIR are required'
    );
  }

  return {
    templateDir: path.resolve(templateDir),
    artifactsDir: path.resolve(artifactsDir),
  };
}

/**
 * Resolves only the artifact directory for routes that must still be
 * registered while readiness reports an invalid runtime configuration.
 */
export function resolveWindowsOfflineInstallerArtifactsDir(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const configuredArtifactsDir = env.CP_OFFLINE_INSTALLER_ARTIFACTS_DIR?.trim();
  if (configuredArtifactsDir) return path.resolve(configuredArtifactsDir);

  const templateDir = env.CP_OFFLINE_INSTALLER_TEMPLATE_DIR?.trim();
  const legacyCacheDir = env.CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR?.trim();
  if (!templateDir && legacyCacheDir) return path.resolve(legacyCacheDir, 'artifacts');

  return path.resolve('./var/windows-offline-installer/artifacts');
}

export function loadWindowsOfflineInstallerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: { openpathUrl?: string } = {}
): WindowsOfflineInstallerConfig {
  const templateSha256 = readRequiredEnv(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_SHA256');
  if (!HEX_SHA256.test(templateSha256)) {
    throw new WindowsOfflineInstallerConfigError(
      'CP_OFFLINE_INSTALLER_TEMPLATE_SHA256 must be a hex SHA-256 digest'
    );
  }

  const templateCommit = readRequiredEnv(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT');
  if (!FULL_COMMIT_SHA.test(templateCommit)) {
    throw new WindowsOfflineInstallerConfigError(
      'CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT must be a full 40-character lowercase commit SHA'
    );
  }

  const templateVersion = readRequiredEnv(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_VERSION');
  if (!TEMPLATE_VERSION.test(templateVersion)) {
    throw new WindowsOfflineInstallerConfigError(
      'CP_OFFLINE_INSTALLER_TEMPLATE_VERSION must be a valid release version'
    );
  }

  const storageDirectories = resolveConfiguredStorageDirectories(env);

  const openpathUrl = overrides.openpathUrl ?? env.OPENPATH_URL?.trim() ?? '';
  if (!openpathUrl) {
    throw new WindowsOfflineInstallerConfigError('OPENPATH_URL is required');
  }

  return {
    tokenTtlHours: readPositiveIntEnv(env, 'CP_OFFLINE_INSTALLER_TOKEN_TTL_HOURS', 24),
    downloadRefTtlMinutes: readPositiveIntEnv(env, 'CP_OFFLINE_INSTALLER_DOWNLOAD_TTL_MINUTES', 10),
    downloadRefMaxAttempts: readPositiveIntEnv(
      env,
      'CP_OFFLINE_INSTALLER_DOWNLOAD_MAX_ATTEMPTS',
      3
    ),
    templateVersion,
    templateCommit,
    templateSha256,
    ...storageDirectories,
    openpathUrl,
  };
}
