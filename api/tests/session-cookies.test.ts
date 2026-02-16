import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_COOKIE_NAME,
  parseCookieValue,
  REFRESH_COOKIE_NAME,
  setSessionCookies,
} from '../src/lib/session-cookies.js';

describe('session cookie helpers', () => {
  it('sets secure HttpOnly cookies with expected names', () => {
    const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        calls.push({ name, value, options });
      },
    };

    setSessionCookies(res as any, { accessToken: 'a-token', refreshToken: 'r-token' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.name, ACCESS_COOKIE_NAME);
    assert.equal(calls[1]?.name, REFRESH_COOKIE_NAME);
    assert.equal(calls[0]?.value, 'a-token');
    assert.equal(calls[1]?.value, 'r-token');
    assert.equal(calls[0]?.options.httpOnly, true);
    assert.equal(calls[1]?.options.httpOnly, true);
    assert.equal(calls[0]?.options.sameSite, 'lax');
    assert.equal(calls[1]?.options.sameSite, 'lax');
    assert.equal(calls[0]?.options.path, '/');
    assert.equal(calls[1]?.options.path, '/');
  });

  it('parses cookie values from Cookie header', () => {
    const cookieHeader = 'a=1; cp_access_token=access.value; cp_refresh_token=refresh.value';

    assert.equal(parseCookieValue(cookieHeader, ACCESS_COOKIE_NAME), 'access.value');
    assert.equal(parseCookieValue(cookieHeader, REFRESH_COOKIE_NAME), 'refresh.value');
    assert.equal(parseCookieValue(cookieHeader, 'missing_cookie'), null);
    assert.equal(parseCookieValue(undefined, ACCESS_COOKIE_NAME), null);
  });
});
