const ACCESS_TOKEN_KEY = 'openpath_access_token';
const REFRESH_TOKEN_KEY = 'openpath_refresh_token';
const USER_KEY = 'openpath_user';
const LEGACY_API_TOKEN_KEY = 'requests_api_token';
const REQUESTS_API_URL_KEY = 'requests_api_url';
const COOKIE_SESSION_MARKER = 'cookie-session';

interface SessionPayload {
  accessToken?: string;
  refreshToken?: string;
  user?: unknown;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getItem(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

function removeItem(key: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}

export function getAccessToken(): string | null {
  const token = getItem(ACCESS_TOKEN_KEY);
  if (token && token !== COOKIE_SESSION_MARKER) {
    return token;
  }
  return null;
}

export function hasSessionMarker(): boolean {
  return getItem(ACCESS_TOKEN_KEY) === COOKIE_SESSION_MARKER;
}

export function persistSession(payload: SessionPayload): void {
  // Store only a non-sensitive marker in localStorage.
  // Sensitive JWTs are delivered via HttpOnly cookies.
  setItem(ACCESS_TOKEN_KEY, COOKIE_SESSION_MARKER);
  removeItem(REFRESH_TOKEN_KEY);
  removeItem(LEGACY_API_TOKEN_KEY);

  void payload.accessToken;
  void payload.refreshToken;

  if (payload.user !== undefined) {
    setItem(USER_KEY, JSON.stringify(payload.user));
  }
}

export function clearSession(): void {
  removeItem(ACCESS_TOKEN_KEY);
  removeItem(REFRESH_TOKEN_KEY);
  removeItem(USER_KEY);
  removeItem(LEGACY_API_TOKEN_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function setRequestsApiUrl(url: string): void {
  setItem(REQUESTS_API_URL_KEY, url);
}

export function clearRequestsApiUrl(): void {
  removeItem(REQUESTS_API_URL_KEY);
}
