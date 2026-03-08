import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';

import {
  ACCESS_COOKIE_NAME,
  clearSessionCookies,
  extractSessionTokens,
  parseCookieValue,
  REFRESH_COOKIE_NAME,
  setSessionCookies,
  storeSessionFromPayload,
  stripSessionTokens,
} from '../src/lib/session-cookies.js';

describe('session cookie helpers', () => {
  it('sets secure HttpOnly cookies with expected names', () => {
    const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        calls.push({ name, value, options });
      },
    };

    setSessionCookies(res as Pick<Response, 'cookie'>, {
      accessToken: 'a-token',
      refreshToken: 'r-token',
    });

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

  it('clears session cookies by setting expired values', () => {
    const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        calls.push({ name, value, options });
      },
    };

    clearSessionCookies(res as Pick<Response, 'cookie'>);

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.name, ACCESS_COOKIE_NAME);
    assert.equal(calls[1]?.name, REFRESH_COOKIE_NAME);
    assert.equal(calls[0]?.value, '');
    assert.equal(calls[1]?.value, '');
    assert.equal(calls[0]?.options.httpOnly, true);
    assert.equal(calls[1]?.options.httpOnly, true);
    assert.equal(calls[0]?.options.path, '/');
    assert.equal(calls[1]?.options.path, '/');
    assert.ok(calls[0]?.options.expires instanceof Date);
    assert.ok(calls[1]?.options.expires instanceof Date);
  });

  it('strips session tokens from auth payloads before returning them to the browser', () => {
    const payload = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      success: true,
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    };

    assert.deepStrictEqual(stripSessionTokens(payload), {
      success: true,
      user: {
        id: 'user-1',
        email: 'user@example.com',
      },
    });
  });

  it('extracts session tokens only when both access and refresh tokens are present', () => {
    assert.deepStrictEqual(
      extractSessionTokens({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }
    );
    assert.equal(extractSessionTokens({ accessToken: 'access-token' }), null);
    assert.equal(extractSessionTokens(['not', 'an', 'object']), null);
  });

  it('stores cookies from a payload and returns the token-stripped result', () => {
    const calls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        calls.push({ name, value, options });
      },
    };

    const sanitized = storeSessionFromPayload(res as Pick<Response, 'cookie'>, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
      },
    });

    assert.deepStrictEqual(sanitized, {
      user: {
        id: 'user-1',
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.name, ACCESS_COOKIE_NAME);
    assert.equal(calls[1]?.name, REFRESH_COOKIE_NAME);
  });
});
