/**
 * ClassroomPath Gateway & Multi-tenancy Integration Tests
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';
import { OAuth2Client, type LoginTicket } from 'google-auth-library';
import {
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  uniqueEmail,
} from '../test-utils.js';
import {
  isMockOpenPathTokenRevoked,
  resetMockOpenPathUpstreamState,
  revokeMockOpenPathToken,
  setMockOpenPathApiTokensListMode,
  setMockOpenPathLogoutMode,
  setMockOpenPathReadyMode,
  setMockOpenPathSystemInfoMode,
  signToken,
  useIntegrationServer,
} from './harness.js';
import { createTenantScenario } from './scenario-builder.js';
import { db as cpDb, schema as cpSchema } from '../../src/db/index.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../../src/lib/session-cookies.js';

const integration = useIntegrationServer({ resetBeforeStart: true });
const ONE_DAY_SECONDS = 24 * 60 * 60;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

function buildScenario() {
  return createTenantScenario({ baseUrl: integration.baseUrl, jwtSecret: JWT_SECRET });
}

async function seedTenantOrganization(params: { token: string; name: string }): Promise<string> {
  const organization = await buildScenario().seedOrganizationForToken({
    token: params.token,
    organizationName: params.name,
  });
  return organization.organizationId;
}

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

describe('ClassroomPath Gateway Integration', async () => {
  test('integration server runs in API-only mode and does not serve SPA routes', async () => {
    const response = await fetch(`${integration.baseUrl}/classrooms`);

    assert.strictEqual(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /html|json/i);
    assert.match(await response.text(), /not found|cannot get/i);
  });

  test('should return 401 for unauthenticated requests to /cp/trpc', async () => {
    const resp = await trpcQuery(integration.baseUrl, 'onboarding.status');
    const { error } = (await parseTRPC(resp)) as { error: string };
    assert.strictEqual(error, 'Not authenticated');
  });

  test('should reject refresh tokens on /cp/trpc/onboarding.status', async () => {
    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'refresh-only-user',
      email: uniqueEmail('refresh'),
      name: 'Refresh Only',
      roles: [],
      type: 'refresh',
    });

    const resp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 401);
    const parsed = (await parseTRPC(resp)) as { error?: string; code?: string };
    assert.strictEqual(parsed.code, 'UNAUTHORIZED');
    assert.match(parsed.error ?? '', /not authenticated|invalid/i);
  });

  test('should reject tokens with the wrong issuer on /cp/trpc/onboarding.status', async () => {
    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'wrong-issuer-user',
      email: uniqueEmail('issuer'),
      name: 'Wrong Issuer',
      roles: [],
      issuer: 'other-service',
    });

    const resp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 401);
    const parsed = (await parseTRPC(resp)) as { error?: string; code?: string };
    assert.strictEqual(parsed.code, 'UNAUTHORIZED');
    assert.match(parsed.error ?? '', /not authenticated|invalid/i);
  });

  test('should reject revoked access tokens on /cp/trpc/onboarding.status', async () => {
    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'revoked-token-user',
      email: uniqueEmail('revoked'),
      name: 'Revoked Token',
      roles: [],
    });
    revokeMockOpenPathToken(token);

    const resp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 401);
    const parsed = (await parseTRPC(resp)) as { error?: string; code?: string };
    assert.strictEqual(parsed.code, 'UNAUTHORIZED');
    assert.match(parsed.error ?? '', /revoked|not authenticated|invalid/i);
  });

  test('should allow valid cookie-backed sessions on /cp/trpc/onboarding.status', async () => {
    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'cookie-session-user',
      email: uniqueEmail('cookie'),
      name: 'Cookie Session',
      roles: [],
    });

    const resp = await fetch(`${integration.baseUrl}/cp/trpc/onboarding.status`, {
      headers: {
        Cookie: `${ACCESS_COOKIE_NAME}=${token}`,
      },
    });
    assertStatus(resp, 200);
    const parsed = (await parseTRPC(resp)) as {
      data?: { hasMembership?: boolean; isWaiting?: boolean; organization?: unknown };
    };
    assert.strictEqual(parsed.data?.hasMembership, false);
    assert.strictEqual(parsed.data?.isWaiting, false);
    assert.strictEqual(parsed.data?.organization, null);
  });

  test('/cp/trpc/auth.login strips tokens from the response body and sets cookie session headers', async () => {
    const email = uniqueEmail('login-body');

    await openpathDb.insert(openpathSchema.users).values({
      id: `login-body-${Date.now()}`,
      email,
      name: 'Login Body User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    const response = await trpcMutate(integration.baseUrl, 'auth.login', {
      email,
      password: 'password123',
    });

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
    assert.strictEqual('accessToken' in (parsed.data ?? {}), false);
    assert.strictEqual('refreshToken' in (parsed.data ?? {}), false);
    assert.ok(parsed.data?.user);

    const setCookies = getSetCookieHeaders(response);
    const accessCookie = setCookies.find((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`));
    const refreshCookie = setCookies.find((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`));
    assert.ok(accessCookie);
    assert.ok(refreshCookie);
    assert.match(accessCookie, new RegExp(`Max-Age=${ONE_DAY_SECONDS}`, 'i'));
    assert.match(refreshCookie, new RegExp(`Max-Age=${ONE_DAY_SECONDS}`, 'i'));
    assert.ok(setCookies.every((cookie) => /HttpOnly/i.test(cookie)));
  });

  test('/cp/trpc/auth.login keeps standalone app refresh sessions for 30 days', async () => {
    const email = uniqueEmail('login-app-session');

    await openpathDb.insert(openpathSchema.users).values({
      id: `login-app-session-${Date.now()}`,
      email,
      name: 'Login App Session User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    const response = await trpcMutate(integration.baseUrl, 'auth.login', {
      email,
      password: 'password123',
      clientMode: 'app',
    });

    assertStatus(response, 200);
    const setCookies = getSetCookieHeaders(response);
    const accessCookie = setCookies.find((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`));
    const refreshCookie = setCookies.find((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`));
    assert.ok(accessCookie);
    assert.ok(refreshCookie);
    assert.match(accessCookie, new RegExp(`Max-Age=${ONE_DAY_SECONDS}`, 'i'));
    assert.match(refreshCookie, new RegExp(`Max-Age=${THIRTY_DAYS_SECONDS}`, 'i'));
  });

  test('/cp/trpc/auth.register persists consent metadata and returns email verification delivery details', async () => {
    const email = uniqueEmail('register-body');
    const response = await trpcMutate(integration.baseUrl, 'auth.register', {
      email,
      name: 'Register Body User',
      password: 'password123',
      termsAccepted: true,
      termsVersion: '2026-03-09',
    });

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
    assert.strictEqual('accessToken' in (parsed.data ?? {}), false);
    assert.strictEqual('refreshToken' in (parsed.data ?? {}), false);
    assert.strictEqual(parsed.data?.email, email);
    assert.strictEqual(parsed.data?.verificationRequired, true);
    assert.strictEqual(parsed.data?.termsVersion, '2026-03-09');
    assert.strictEqual(typeof parsed.data?.emailSent, 'boolean');
    assert.ok(String(parsed.data?.verificationUrl ?? '').includes('/login?email='));

    const setCookies = getSetCookieHeaders(response);
    assert.strictEqual(setCookies.length, 0);

    const [registeredUser] = await openpathDb
      .select({ id: openpathSchema.users.id })
      .from(openpathSchema.users)
      .where(eq(openpathSchema.users.email, email))
      .limit(1);
    assert.ok(registeredUser);

    const consent = await cpDb
      .select()
      .from(cpSchema.cpTermsAcceptance)
      .where(eq(cpSchema.cpTermsAcceptance.userId, registeredUser.id));
    assert.strictEqual(consent.length, 1);
    assert.strictEqual(consent[0]?.termsVersion, '2026-03-09');
  });

  test('/cp/trpc/auth.register returns service unavailable when upstream responds with invalid JSON', async () => {
    const response = await trpcMutate(integration.baseUrl, 'auth.register', {
      email: 'mock-register-invalid-json@test.local',
      name: 'Broken Register User',
      password: 'password123',
      termsAccepted: true,
      termsVersion: '2026-03-09',
    });

    assertStatus(response, 500);
    const parsed = (await parseTRPC(response)) as { error?: string; code?: string };
    assert.strictEqual(parsed.code, 'INTERNAL_SERVER_ERROR');
    assert.strictEqual(parsed.error, 'Registration service unavailable');
  });

  test('/cp/trpc/auth.generateEmailVerificationToken sends a fresh verification payload without creating a session', async () => {
    const email = uniqueEmail('verify-resend');

    await openpathDb.insert(openpathSchema.users).values({
      id: `verify-resend-${Date.now()}`,
      email,
      name: 'Verify Resend User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: false,
    });

    const response = await trpcMutate(integration.baseUrl, 'auth.generateEmailVerificationToken', {
      email,
    });

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
    assert.strictEqual(parsed.data?.email, email);
    assert.strictEqual(parsed.data?.verificationRequired, true);
    assert.strictEqual(typeof parsed.data?.emailSent, 'boolean');
    assert.ok(String(parsed.data?.verificationUrl ?? '').includes('/login?email='));
    assert.strictEqual(getSetCookieHeaders(response).length, 0);
  });

  test('/cp/trpc/auth.verifyEmail forwards success and marks the user as verified', async () => {
    const email = uniqueEmail('verify-email');

    await openpathDb.insert(openpathSchema.users).values({
      id: `verify-email-${Date.now()}`,
      email,
      name: 'Verify Email User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: false,
    });

    const tokenResponse = await trpcMutate(
      integration.baseUrl,
      'auth.generateEmailVerificationToken',
      {
        email,
      }
    );

    assertStatus(tokenResponse, 200);
    const tokenPayload = (await parseTRPC(tokenResponse)) as {
      data?: { verificationUrl?: string };
    };
    const verificationUrl = String(tokenPayload.data?.verificationUrl ?? '');
    const verificationToken = new URL(verificationUrl).searchParams.get('token');
    assert.ok(verificationToken);

    const verifyResponse = await trpcMutate(integration.baseUrl, 'auth.verifyEmail', {
      email,
      token: verificationToken,
    });

    assertStatus(verifyResponse, 200);
    const parsed = (await parseTRPC(verifyResponse)) as { data?: { success?: boolean } };
    assert.strictEqual(parsed.data?.success, true);

    const [user] = await openpathDb
      .select({ emailVerified: openpathSchema.users.emailVerified })
      .from(openpathSchema.users)
      .where(eq(openpathSchema.users.email, email))
      .limit(1);

    assert.strictEqual(user?.emailVerified, true);
  });

  test('/cp/trpc/auth.googleLogin strips tokens from the response body and sets cookie session headers', async () => {
    const response = await trpcMutate(integration.baseUrl, 'auth.googleLogin', {
      idToken: 'google-id-token',
    });

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
    assert.strictEqual('accessToken' in (parsed.data ?? {}), false);
    assert.strictEqual('refreshToken' in (parsed.data ?? {}), false);
    assert.ok(parsed.data?.user);

    const setCookies = getSetCookieHeaders(response);
    assert.ok(setCookies.some((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`)));
    assert.ok(setCookies.some((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`)));
  });

  test('/cp/trpc/auth.googleSignup provisions a Google user, records consent metadata, and sets cookie session headers', async () => {
    const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    const originalVerifyIdToken = Reflect.get(OAuth2Client.prototype, 'verifyIdToken');

    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    OAuth2Client.prototype.verifyIdToken = ((): Promise<LoginTicket> =>
      Promise.resolve({
        getPayload: () => ({
          email: 'new-google-signup@test.local',
          sub: 'google-signup-sub',
          name: 'New Google Signup',
        }),
      } as unknown as LoginTicket)) as typeof OAuth2Client.prototype.verifyIdToken;

    try {
      const response = await trpcMutate(integration.baseUrl, 'auth.googleSignup', {
        idToken: 'new-google-signup-token',
        termsAccepted: true,
        termsVersion: '2026-03-09',
      });

      assertStatus(response, 200);
      const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
      assert.strictEqual('accessToken' in (parsed.data ?? {}), false);
      assert.strictEqual('refreshToken' in (parsed.data ?? {}), false);
      assert.strictEqual(
        (parsed.data?.user as { email?: string } | undefined)?.email,
        'new-google-signup@test.local'
      );

      const [user] = await openpathDb
        .select({
          id: openpathSchema.users.id,
          email: openpathSchema.users.email,
          emailVerified: openpathSchema.users.emailVerified,
          googleId: openpathSchema.users.googleId,
        })
        .from(openpathSchema.users)
        .where(eq(openpathSchema.users.email, 'new-google-signup@test.local'))
        .limit(1);

      assert.ok(user);
      assert.strictEqual(user.googleId, 'google-signup-sub');
      assert.strictEqual(user.emailVerified, true);

      const [consent] = await cpDb
        .select({
          userId: cpSchema.cpTermsAcceptance.userId,
          termsVersion: cpSchema.cpTermsAcceptance.termsVersion,
        })
        .from(cpSchema.cpTermsAcceptance)
        .where(eq(cpSchema.cpTermsAcceptance.userId, user.id))
        .limit(1);

      assert.deepStrictEqual(consent, {
        userId: user.id,
        termsVersion: '2026-03-09',
      });

      const setCookies = getSetCookieHeaders(response);
      assert.ok(setCookies.some((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`)));
      assert.ok(setCookies.some((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`)));
    } finally {
      if (originalGoogleClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
      } else {
        process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
      }
      OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    }
  });

  test('/cp/trpc/auth.googleSignup links an existing email user, verifies it, and keeps the cookie session flow', async () => {
    const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    const originalVerifyIdToken = Reflect.get(OAuth2Client.prototype, 'verifyIdToken');

    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

    await openpathDb.insert(openpathSchema.users).values({
      id: 'existing-email-google-signup-user',
      email: 'existing-email-google-signup@test.local',
      name: 'Existing Email Signup User',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: false,
    });

    OAuth2Client.prototype.verifyIdToken = ((): Promise<LoginTicket> =>
      Promise.resolve({
        getPayload: () => ({
          email: 'existing-email-google-signup@test.local',
          sub: 'existing-email-google-signup-sub',
          name: '',
        }),
      } as unknown as LoginTicket)) as typeof OAuth2Client.prototype.verifyIdToken;

    try {
      const response = await trpcMutate(integration.baseUrl, 'auth.googleSignup', {
        idToken: 'existing-email-google-signup-token',
        termsAccepted: true,
        termsVersion: '2026-03-09',
      });

      assertStatus(response, 200);
      const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
      assert.strictEqual('accessToken' in (parsed.data ?? {}), false);
      assert.strictEqual('refreshToken' in (parsed.data ?? {}), false);
      assert.strictEqual(
        (parsed.data?.user as { email?: string } | undefined)?.email,
        'existing-email-google-signup@test.local'
      );

      const [user] = await openpathDb
        .select({
          emailVerified: openpathSchema.users.emailVerified,
          googleId: openpathSchema.users.googleId,
        })
        .from(openpathSchema.users)
        .where(eq(openpathSchema.users.email, 'existing-email-google-signup@test.local'))
        .limit(1);

      assert.strictEqual(user?.emailVerified, true);
      assert.strictEqual(user?.googleId, 'existing-email-google-signup-sub');

      const setCookies = getSetCookieHeaders(response);
      assert.ok(setCookies.some((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`)));
      assert.ok(setCookies.some((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`)));
    } finally {
      if (originalGoogleClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
      } else {
        process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
      }
      OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    }
  });

  test('/cp/trpc/auth.googleSignup fails closed when Google OAuth is not configured', async () => {
    const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;

    delete process.env.GOOGLE_CLIENT_ID;

    try {
      const response = await trpcMutate(integration.baseUrl, 'auth.googleSignup', {
        idToken: 'missing-google-config-token',
        termsAccepted: true,
        termsVersion: '2026-03-09',
      });

      assertStatus(response, 401);
      const parsed = (await parseTRPC(response)) as { error?: string; code?: string };
      assert.strictEqual(parsed.code, 'UNAUTHORIZED');
      assert.match(parsed.error ?? '', /google oauth not configured/i);
    } finally {
      if (originalGoogleClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
      } else {
        process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
      }
    }
  });

  test('/cp/trpc/auth.logout revokes both access and refresh tokens when a cookie session is present', async () => {
    const accessToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'logout-cookie-user',
      email: uniqueEmail('logout-cookie'),
      name: 'Logout Cookie User',
      roles: [],
    });
    const refreshToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'logout-cookie-user',
      email: uniqueEmail('logout-cookie-refresh'),
      name: 'Logout Cookie User',
      roles: [],
      type: 'refresh',
    });

    const response = await trpcMutate(integration.baseUrl, 'auth.logout', undefined, {
      ...bearerAuth(accessToken),
      Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}`,
    });

    assertStatus(response, 200);
    assert.strictEqual(isMockOpenPathTokenRevoked(accessToken), true);
    assert.strictEqual(isMockOpenPathTokenRevoked(refreshToken), true);
  });

  test('/cp/trpc/auth.changePassword forwards the authenticated password change to OpenPath', async () => {
    const accessToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'change-password-user',
      email: uniqueEmail('change-password'),
      name: 'Change Password User',
      roles: [],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'auth.changePassword',
      {
        currentPassword: 'CurrentPassword123!',
        newPassword: 'NewPassword456!',
      },
      bearerAuth(accessToken)
    );

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: { success?: boolean } };
    assert.strictEqual(parsed.data?.success, true);
  });

  test('/cp/trpc/auth.logout clears local cookies but returns an explicit degraded error when upstream revocation fails', async () => {
    const accessToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'logout-cookie-failure-user',
      email: uniqueEmail('logout-cookie-failure'),
      name: 'Logout Cookie Failure User',
      roles: [],
    });
    const refreshToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: 'logout-cookie-failure-user',
      email: uniqueEmail('logout-cookie-failure-refresh'),
      name: 'Logout Cookie Failure User',
      roles: [],
      type: 'refresh',
    });

    setMockOpenPathLogoutMode('unavailable');

    try {
      const response = await trpcMutate(integration.baseUrl, 'auth.logout', undefined, {
        ...bearerAuth(accessToken),
        Cookie: `${REFRESH_COOKIE_NAME}=${refreshToken}`,
      });

      assertStatus(response, 503);

      const parsed = (await parseTRPC(response)) as { error?: string; code?: string };
      assert.strictEqual(parsed.code, 'SERVICE_UNAVAILABLE');
      assert.match(parsed.error ?? '', /sesión local se cerró|logout|revoc/i);
      assert.strictEqual(isMockOpenPathTokenRevoked(accessToken), false);
      assert.strictEqual(isMockOpenPathTokenRevoked(refreshToken), false);

      const setCookies = getSetCookieHeaders(response);
      assert.ok(setCookies.some((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`)));
      assert.ok(setCookies.some((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`)));
      assert.ok(setCookies.every((cookie) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cookie)));
    } finally {
      resetMockOpenPathUpstreamState();
    }
  });

  test('/cp/trpc/auth.resetPassword forwards upstream success payload', async () => {
    const response = await trpcMutate(integration.baseUrl, 'auth.resetPassword', {
      email: uniqueEmail('reset-password'),
      token: 'mock-reset-ok',
      newPassword: 'password1234',
    });

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: { success?: boolean } };
    assert.strictEqual(parsed.data?.success, true);
  });

  test('/cp/trpc/auth.resetPassword preserves upstream bad-request responses', async () => {
    const response = await trpcMutate(integration.baseUrl, 'auth.resetPassword', {
      email: uniqueEmail('reset-password-bad-request'),
      token: 'mock-reset-bad-request',
      newPassword: 'password1234',
    });

    assertStatus(response, 400);
    const parsed = (await parseTRPC(response)) as { error?: string; code?: string };
    assert.strictEqual(parsed.code, 'BAD_REQUEST');
    assert.strictEqual(parsed.error, 'Reset token is invalid or expired');
  });

  test('/cp/trpc/auth.generateResetToken omits secret-bearing reset URLs from the browser response', async () => {
    const orgId = `org-reset-shape-${Date.now()}`;
    const adminUserId = `u-admin-reset-shape-${Date.now()}`;
    const teacherUserId = `u-teacher-reset-shape-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-reset-shape');
    const teacherEmail = uniqueEmail('teacher-reset-shape');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Reset Shape',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: teacherUserId,
        email: teacherEmail,
        name: 'Teacher Reset Shape',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

    await openpathDb.insert(openpathSchema.roles).values([
      {
        id: `role-${adminUserId}`,
        userId: adminUserId,
        role: 'admin',
        groupIds: [],
        createdBy: adminUserId,
      },
      {
        id: `role-${teacherUserId}`,
        userId: teacherUserId,
        role: 'teacher',
        groupIds: [],
        createdBy: adminUserId,
      },
    ]);

    await cpDb.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: 'Gateway Reset Shape Org',
      createdBy: adminUserId,
    });

    await cpDb.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: orgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${teacherUserId}`,
        userId: teacherUserId,
        organizationId: orgId,
        role: 'teacher',
        invitedBy: adminUserId,
      },
    ]);

    await cpDb.insert(cpSchema.cpOrganizationEntitlements).values({
      organizationId: orgId,
      source: 'manual_admin',
      status: 'active',
      productKind: 'annual',
      classroomLimit: 100,
      grantedBy: adminUserId,
    });

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Reset Shape',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const response = await trpcMutate(
      integration.baseUrl,
      'auth.generateResetToken',
      { email: teacherEmail },
      bearerAuth(adminToken)
    );

    assertStatus(response, 200);
    const parsed = (await parseTRPC(response)) as { data?: Record<string, unknown> };
    assert.strictEqual(parsed.data?.success, true);
    assert.strictEqual(parsed.data?.emailSent, true);
    assert.strictEqual('resetUrl' in (parsed.data ?? {}), false);
  });

  test('/cp/trpc/auth.generateResetToken fails explicitly and rolls back the reset token when delivery is unavailable', async () => {
    const originalResendApiKey = process.env.RESEND_API_KEY;
    const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    try {
      const orgId = `org-reset-delivery-${Date.now()}`;
      const adminUserId = `u-admin-reset-delivery-${Date.now()}`;
      const teacherUserId = `u-teacher-reset-delivery-${Date.now()}`;
      const adminEmail = uniqueEmail('admin-reset-delivery');
      const teacherEmail = uniqueEmail('teacher-reset-delivery');

      await openpathDb.insert(openpathSchema.users).values([
        {
          id: adminUserId,
          email: adminEmail,
          name: 'Admin Reset Delivery',
          passwordHash: 'hashed',
          isActive: true,
          emailVerified: true,
        },
        {
          id: teacherUserId,
          email: teacherEmail,
          name: 'Teacher Reset Delivery',
          passwordHash: 'hashed',
          isActive: true,
          emailVerified: true,
        },
      ]);

      await openpathDb.insert(openpathSchema.roles).values([
        {
          id: `role-${adminUserId}`,
          userId: adminUserId,
          role: 'admin',
          groupIds: [],
          createdBy: adminUserId,
        },
        {
          id: `role-${teacherUserId}`,
          userId: teacherUserId,
          role: 'teacher',
          groupIds: [],
          createdBy: adminUserId,
        },
      ]);

      await cpDb.insert(cpSchema.cpOrganizations).values({
        id: orgId,
        name: 'Gateway Reset Delivery Org',
        createdBy: adminUserId,
      });

      await cpDb.insert(cpSchema.cpMemberships).values([
        {
          id: `mem-${adminUserId}`,
          userId: adminUserId,
          organizationId: orgId,
          role: 'admin',
          invitedBy: adminUserId,
        },
        {
          id: `mem-${teacherUserId}`,
          userId: teacherUserId,
          organizationId: orgId,
          role: 'teacher',
          invitedBy: adminUserId,
        },
      ]);

      await cpDb.insert(cpSchema.cpOrganizationEntitlements).values({
        organizationId: orgId,
        source: 'manual_admin',
        status: 'active',
        productKind: 'annual',
        classroomLimit: 100,
        grantedBy: adminUserId,
      });

      const adminToken = signToken({
        jwtSecret: JWT_SECRET,
        userId: adminUserId,
        email: adminEmail,
        name: 'Admin Reset Delivery',
        roles: [{ role: 'admin', groupIds: [] }],
      });

      const response = await trpcMutate(
        integration.baseUrl,
        'auth.generateResetToken',
        { email: teacherEmail },
        bearerAuth(adminToken)
      );

      assertStatus(response, 503);
      const parsed = (await parseTRPC(response)) as { error?: string; code?: string };
      assert.strictEqual(parsed.code, 'SERVICE_UNAVAILABLE');
      assert.strictEqual(
        parsed.error,
        'No se pudo enviar el correo de recuperación. Genera un nuevo correo para reintentar.'
      );

      const tokens = await openpathDb
        .select()
        .from(openpathSchema.passwordResetTokens)
        .where(eq(openpathSchema.passwordResetTokens.userId, teacherUserId));
      assert.strictEqual(tokens.length, 0);
    } finally {
      if (originalResendApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = originalResendApiKey;
      }

      if (originalResendFromEmail === undefined) {
        delete process.env.RESEND_FROM_EMAIL;
      } else {
        process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
      }
    }
  });

  test('/cp/trpc/auth.resetPassword returns service unavailable when upstream responds with invalid JSON', async () => {
    const response = await trpcMutate(integration.baseUrl, 'auth.resetPassword', {
      email: uniqueEmail('reset-password-invalid-json'),
      token: 'mock-reset-invalid-json',
      newPassword: 'password1234',
    });

    assertStatus(response, 500);
    const parsed = (await parseTRPC(response)) as { error?: string; code?: string };
    assert.strictEqual(parsed.code, 'INTERNAL_SERVER_ERROR');
    assert.strictEqual(parsed.error, 'Authentication service unavailable');
  });

  test('should allow onboarding for new users', async () => {
    const scenario = buildScenario();
    const actor = await scenario.createActor({
      userId: 'user-123',
      name: 'Test User',
      emailPrefix: 'user',
    });

    // 1. Check status (should be not onboarded)
    const statusResp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(actor.token)
    );
    assertStatus(statusResp, 200);
    const { data: status } = (await parseTRPC(statusResp)) as { data: any };
    assert.strictEqual(status.hasMembership, false);

    // 2. Complete tenant setup through the tenant scenario boundary
    await scenario.seedOrganizationForActor({ actor, organizationName: 'Test Organization' });

    // 3. Verify status now shows membership
    const newStatusResp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(actor.token)
    );
    const { data: newStatus } = (await parseTRPC(newStatusResp)) as { data: any };
    assert.strictEqual(newStatus.hasMembership, true);
    assert.strictEqual(newStatus.organization.name, 'Test Organization');
  });

  test('should block direct access to sensitive OpenPath procedures', async () => {
    // Procedure 'groups.list' is in BLOCKED_OPENPATH_PROCEDURES in server.ts
    const resp = await fetch(`${integration.baseUrl}/trpc/groups.list`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
  });

  test('should block direct access to non-tenant upstream admin procedures', async () => {
    for (const procedure of [
      'setup.getRegistrationToken',
      'auth.generateResetToken',
      'healthReports.list',
      'auth.me',
    ]) {
      const resp = await fetch(`${integration.baseUrl}/trpc/${procedure}`);
      assert.strictEqual(resp.status, 403, `${procedure} should be blocked`);
      const json = (await resp.json()) as any;
      assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
      assert.strictEqual(json.error.data.blocked, procedure);
    }
  });

  test('should route /cp/health correctly', async () => {
    const resp = await fetch(`${integration.baseUrl}/cp/health`);
    assert.strictEqual(resp.status, 200);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.service, 'classroompath-gateway');
  });

  test('/cp/health stays live even when upstream readiness is unavailable', async () => {
    setMockOpenPathReadyMode('unavailable');
    try {
      const resp = await fetch(`${integration.baseUrl}/cp/health`);
      assert.strictEqual(resp.status, 200);
      const json = (await resp.json()) as { status?: string; service?: string };
      assert.strictEqual(json.status, 'ok');
      assert.strictEqual(json.service, 'classroompath-gateway');
    } finally {
      resetMockOpenPathUpstreamState();
    }
  });

  test('/cp/ready fails when upstream readiness is unavailable', async () => {
    setMockOpenPathReadyMode('unavailable');
    try {
      const resp = await fetch(`${integration.baseUrl}/cp/ready`);
      assert.strictEqual(resp.status, 503);
      const json = (await resp.json()) as {
        status?: string;
        upstreamAvailable?: boolean;
        databaseConnected?: boolean;
        databaseSchemaReady?: boolean;
        missingTables?: string[];
      };
      assert.strictEqual(json.status, 'not_ready');
      assert.strictEqual(json.upstreamAvailable, false);
      assert.strictEqual(json.databaseConnected, true);
      assert.strictEqual(json.databaseSchemaReady, true);
      assert.deepStrictEqual(json.missingTables, []);
    } finally {
      resetMockOpenPathUpstreamState();
    }
  });

  test('should block requests.list on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/requests.list`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'requests.list');
  });

  test('should block requests.create on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/requests.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'blocked-create.test' }),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'requests.create');
  });

  test('should block requests.approve mutation on /trpc', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/requests.approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.approve');
  });

  test('should block requests.reject mutation on /trpc', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/requests.reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.reject');
  });

  test('should block requests.delete mutation on /trpc', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/requests.delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.delete');
  });

  test('should block requests.listGroups on /trpc', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/requests.listGroups`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.listGroups');
  });

  test('should block groups.listRulesGrouped on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/groups.listRulesGrouped`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'groups.listRulesGrouped');
  });

  test('should block schedules.getMine on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${integration.baseUrl}/trpc/schedules.getMine`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'schedules.getMine');
  });

  test('should block batched requests containing blocked procedures', async () => {
    // tRPC batch format: /trpc/proc1,proc2
    const resp = await fetch(`${integration.baseUrl}/trpc/health.check,requests.list`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'health.check');
  });

  test('/cp/trpc/requests.listGroups should work for authenticated tenant user', async () => {
    const scenario = buildScenario();
    const actor = await scenario.createActor({
      userId: 'user-listgroups-test',
      name: 'ListGroups Test User',
      emailPrefix: 'listgroups',
    });

    await scenario.seedOrganizationForActor({ actor, organizationName: 'ListGroups Test Org' });

    // Now call listGroups - should return empty array (no groups assigned yet)
    const resp = await trpcQuery(
      integration.baseUrl,
      'requests.listGroups',
      undefined,
      bearerAuth(actor.token)
    );
    assertStatus(resp, 200);
    const { data } = (await parseTRPC(resp)) as { data: any[] };
    assert.ok(Array.isArray(data), 'listGroups should return an array');
  });

  // =========================================
  // New Gateway Endpoint Tests (Session 2026-02-07)
  // =========================================

  test('/cp/trpc/auth.me returns the upstream-authenticated user profile', async () => {
    const scenario = buildScenario();
    const userName = 'Auth Me Test User';
    const actor = await scenario.createActor({
      userId: 'user-auth-me-test',
      name: userName,
      emailPrefix: 'authme',
    });

    await scenario.seedOrganizationForActor({ actor, organizationName: 'Auth Me Test Org' });

    const resp = await trpcQuery(
      integration.baseUrl,
      'auth.me',
      undefined,
      bearerAuth(actor.token)
    );
    assertStatus(resp, 200);
    const parsed = (await parseTRPC(resp)) as {
      data?: {
        user?: {
          id?: string;
          email?: string;
          name?: string;
        };
      };
    };
    assert.strictEqual(parsed.data?.user?.id, actor.userId);
    assert.strictEqual(parsed.data?.user?.email, actor.email);
    assert.strictEqual(parsed.data?.user?.name, userName);
  });

  test('/cp/trpc/healthcheck.systemInfo surfaces degraded upstream state', async () => {
    const userId = 'user-healthcheck-test';
    const email = uniqueEmail('healthcheck');

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: 'Healthcheck Test User',
        passwordHash: 'hashed',
        emailVerified: true,
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'Healthcheck Test User',
      roles: [],
    });

    await seedTenantOrganization({ token, name: 'Healthcheck Test Org' });

    setMockOpenPathSystemInfoMode('unavailable');
    try {
      const resp = await trpcQuery(
        integration.baseUrl,
        'healthcheck.systemInfo',
        undefined,
        bearerAuth(token)
      );
      assertStatus(resp, 200);
      const parsed = (await parseTRPC(resp)) as {
        data?: {
          degraded?: boolean;
          upstreamAvailable?: boolean;
          databaseConnected?: boolean;
          version?: string;
        };
      };
      assert.strictEqual(parsed.data?.degraded, true);
      assert.strictEqual(parsed.data?.upstreamAvailable, false);
      assert.strictEqual(parsed.data?.databaseConnected, false);
      assert.equal(typeof parsed.data?.version, 'string');
    } finally {
      resetMockOpenPathUpstreamState();
    }
  });

  test('/cp/trpc/apiTokens.list returns SERVICE_UNAVAILABLE when OpenPath API is unavailable', async () => {
    const userId = 'user-apitokens-test';
    const email = uniqueEmail('apitokens');

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: 'API Tokens Test User',
        passwordHash: 'hashed',
        emailVerified: true,
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'API Tokens Test User',
      roles: [],
    });

    await seedTenantOrganization({ token, name: 'API Tokens Test Org' });

    setMockOpenPathApiTokensListMode('unavailable');
    try {
      const resp = await trpcQuery(
        integration.baseUrl,
        'apiTokens.list',
        undefined,
        bearerAuth(token)
      );
      assert.strictEqual(resp.status, 503);
      const parsed = (await parseTRPC(resp)) as { error?: string; code?: string };
      assert.ok(parsed.error, 'Expected error payload');
      assert.strictEqual(parsed.code, 'SERVICE_UNAVAILABLE');
    } finally {
      resetMockOpenPathUpstreamState();
    }
  });

  test('/cp/trpc/apiTokens.create creates an API token through the upstream bridge', async () => {
    const userId = 'user-apitokens-create-test';
    const email = uniqueEmail('apitokenscreate');

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: 'API Tokens Create Test User',
        passwordHash: 'hashed',
        emailVerified: true,
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'API Tokens Create Test User',
      roles: [],
    });

    await seedTenantOrganization({ token, name: 'API Tokens Create Test Org' });

    const createResp = await trpcMutate(
      integration.baseUrl,
      'apiTokens.create',
      { name: 'Test Token', expiresInDays: 30 },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);
    const parsed = (await parseTRPC(createResp)) as {
      data?: {
        id?: string;
        name?: string;
        token?: string;
      };
    };
    assert.strictEqual(parsed.data?.id, 'tok_mock');
    assert.strictEqual(parsed.data?.name, 'Mock Token');
    assert.strictEqual(parsed.data?.token, 'tok_mock_secret');
  });

  test('/cp/trpc/groups.list should include rule counts (whitelistCount, blockedSubdomainCount, blockedPathCount)', async () => {
    const userId = 'user-groups-counts-test';
    const email = uniqueEmail('groupscounts');

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: 'Groups Counts Test User',
        passwordHash: 'hashed',
        emailVerified: true,
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'Groups Counts Test User',
      roles: [],
    });

    await seedTenantOrganization({ token, name: 'Groups Counts Test Org' });

    // Create a group
    const createResp = await trpcMutate(
      integration.baseUrl,
      'groups.create',
      { name: 'test-group-counts', displayName: 'Test Group with Counts' },
      bearerAuth(token)
    );
    const createGroupFailureBody =
      createResp.status === 200 ? undefined : await createResp.clone().text();
    assertStatus(createResp, 200, createGroupFailureBody);
    const { data: group } = (await parseTRPC(createResp)) as { data: any };

    // Add a whitelist rule
    await trpcMutate(
      integration.baseUrl,
      'groups.addRule',
      { groupId: group.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(token)
    );

    // Fetch groups.list and verify counts are present
    const listResp = await trpcQuery(
      integration.baseUrl,
      'groups.list',
      undefined,
      bearerAuth(token)
    );
    assertStatus(listResp, 200);
    const { data: groups } = (await parseTRPC(listResp)) as { data: any[] };

    const testGroup = groups.find((g) => g.id === group.id);
    assert.ok(testGroup, 'Created group should be in list');
    assert.strictEqual(
      typeof testGroup.whitelistCount,
      'number',
      'whitelistCount should be a number'
    );
    assert.strictEqual(
      typeof testGroup.blockedSubdomainCount,
      'number',
      'blockedSubdomainCount should be a number'
    );
    assert.strictEqual(
      typeof testGroup.blockedPathCount,
      'number',
      'blockedPathCount should be a number'
    );
    assert.strictEqual(testGroup.whitelistCount, 1, 'whitelistCount should be 1 after adding rule');
    assert.strictEqual(testGroup.blockedSubdomainCount, 0, 'blockedSubdomainCount should be 0');
    assert.strictEqual(testGroup.blockedPathCount, 0, 'blockedPathCount should be 0');
  });

  test('/cp/trpc/groups.systemStatus should return enabled/disabled group counts', async () => {
    const userId = 'user-system-status-test';
    const email = uniqueEmail('systemstatus');

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: 'System Status Test User',
        passwordHash: 'hashed',
        emailVerified: true,
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'System Status Test User',
      roles: [],
    });

    await seedTenantOrganization({ token, name: 'System Status Test Org' });

    // Call groups.systemStatus
    const resp = await trpcQuery(
      integration.baseUrl,
      'groups.systemStatus',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 200);
    const { data } = (await parseTRPC(resp)) as { data: any };
    assert.ok(data, 'groups.systemStatus should return data');
    assert.strictEqual(typeof data.enabledGroups, 'number', 'enabledGroups should be a number');
    assert.strictEqual(typeof data.disabledGroups, 'number', 'disabledGroups should be a number');
    assert.strictEqual(typeof data.totalGroups, 'number', 'totalGroups should be a number');

    // OpenPath-compatible shape (OpenPath SPA expects these fields)
    assert.strictEqual(typeof data.enabled, 'boolean', 'enabled should be a boolean');
    assert.strictEqual(typeof data.activeGroups, 'number', 'activeGroups should be a number');
    assert.strictEqual(typeof data.pausedGroups, 'number', 'pausedGroups should be a number');

    // Invariants
    assert.strictEqual(
      data.activeGroups,
      data.enabledGroups,
      'activeGroups should match enabledGroups'
    );
    assert.strictEqual(
      data.pausedGroups,
      data.disabledGroups,
      'pausedGroups should match disabledGroups'
    );
    assert.strictEqual(
      data.totalGroups,
      data.enabledGroups + data.disabledGroups,
      'totalGroups should match enabledGroups + disabledGroups'
    );
    assert.strictEqual(
      data.enabled,
      data.activeGroups > 0,
      'enabled should be true when activeGroups > 0'
    );
  });
});
