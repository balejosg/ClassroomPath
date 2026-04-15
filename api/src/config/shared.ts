export type RuntimeEnv = Record<string, string | undefined>;

export const DEFAULT_JWT_SECRET = 'dev-secret-key-change-me-in-production';

export function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function isProduction(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function isLocalDevelopment(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === undefined;
}
