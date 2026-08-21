import path from 'node:path';

export interface WindowsOfflineInstallerConfig {
  tokenTtlHours: number;
  downloadRefTtlMinutes: number;
  downloadRefMaxAttempts: number;
  templateVersion: string;
  templateSha256: string;
  templateCacheDir: string;
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

export function loadWindowsOfflineInstallerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: { openpathUrl?: string } = {}
): WindowsOfflineInstallerConfig {
  const templateSha256 = readRequiredEnv(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_SHA256').toLowerCase();
  if (!HEX_SHA256.test(templateSha256)) {
    throw new WindowsOfflineInstallerConfigError(
      'CP_OFFLINE_INSTALLER_TEMPLATE_SHA256 must be a hex SHA-256 digest'
    );
  }

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
    templateVersion: readRequiredEnv(env, 'CP_OFFLINE_INSTALLER_TEMPLATE_VERSION'),
    templateSha256,
    templateCacheDir: path.resolve(
      env.CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR ?? './var/windows-offline-installer'
    ),
    openpathUrl,
  };
}
