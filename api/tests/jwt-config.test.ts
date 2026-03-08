import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';

const ORIGINAL_ENV = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY,
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  restoreEnv();
});

function restoreEnv(): void {
  setEnv('JWT_SECRET', ORIGINAL_ENV.JWT_SECRET);
  setEnv('JWT_ACCESS_EXPIRY', ORIGINAL_ENV.JWT_ACCESS_EXPIRY);
  setEnv('JWT_REFRESH_EXPIRY', ORIGINAL_ENV.JWT_REFRESH_EXPIRY);
  setEnv('JWT_EXPIRES_IN', ORIGINAL_ENV.JWT_EXPIRES_IN);
  setEnv('JWT_REFRESH_EXPIRES_IN', ORIGINAL_ENV.JWT_REFRESH_EXPIRES_IN);
  setEnv('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function assertTokenLifetime(
  token: string,
  secret: string,
  expectedType: 'access' | 'refresh',
  expectedSeconds: number
): void {
  const payload = jwt.verify(token, secret, { issuer: 'openpath-api' });
  assert.ok(payload && typeof payload === 'object');
  assert.strictEqual(payload.type, expectedType);
  assert.strictEqual(typeof payload.iat, 'number');
  assert.strictEqual(typeof payload.exp, 'number');

  const actualSeconds = payload.exp - payload.iat;
  assert.ok(
    Math.abs(actualSeconds - expectedSeconds) <= 1,
    `Expected ${expectedType} lifetime near ${expectedSeconds}s, got ${actualSeconds}s`
  );
}

describe('ClassroomPath JWT configuration', () => {
  it('uses the shared JWT expiry env names for locally re-issued session tokens', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'task5-classroompath-secret';
    process.env.JWT_ACCESS_EXPIRY = '17m';
    process.env.JWT_REFRESH_EXPIRY = '9d';
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_REFRESH_EXPIRES_IN;

    const tag = `task5-classroompath-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { generateTokens } = await import(`../src/lib/jwt.ts?${tag}`);

    const tokens = generateTokens(
      {
        id: 'teacher-1',
        email: 'teacher@example.com',
        name: 'Teacher Example',
      },
      []
    );

    assert.strictEqual(tokens.expiresIn, '17m');
    assertTokenLifetime(tokens.accessToken, process.env.JWT_SECRET, 'access', 17 * 60);
    assertTokenLifetime(tokens.refreshToken, process.env.JWT_SECRET, 'refresh', 9 * 24 * 60 * 60);
  });
});
