/**
 * ClassroomPath Gateway & Multi-tenancy Integration Tests
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';
import { revokeMockOpenPathToken, signToken, useIntegrationServer } from './harness.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { ACCESS_COOKIE_NAME } from '../../src/lib/session-cookies.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

describe('ClassroomPath Gateway Integration', async () => {
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

  test('should allow onboarding for new users', async () => {
    const userId = 'user-123';
    const email = uniqueEmail('user');

    // Setup: User must exist in OpenPath for createOrganization to succeed
    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Test User',
      passwordHash: 'hashed',
    });

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'Test User',
      roles: [],
    });

    // 1. Check status (should be not onboarded)
    const statusResp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assertStatus(statusResp, 200);
    const { data: status } = (await parseTRPC(statusResp)) as { data: any };
    assert.strictEqual(status.hasMembership, false);

    // 2. Create organization
    const createResp = await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      {
        name: 'Test Organization',
      },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);

    // 3. Verify status now shows membership
    const newStatusResp = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
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

  test('should route /cp/health correctly', async () => {
    const resp = await fetch(`${integration.baseUrl}/cp/health`);
    assert.strictEqual(resp.status, 200);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.service, 'classroompath-gateway');
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
    assert.strictEqual(json.error.data.blocked, 'requests.list');
  });

  test('/cp/trpc/requests.listGroups should work for authenticated tenant user', async () => {
    // Create a user with organization membership
    const userId = 'user-listgroups-test';
    const email = uniqueEmail('listgroups');

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: 'ListGroups Test User',
        passwordHash: 'hashed',
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'ListGroups Test User',
      roles: [],
    });

    // Create organization first
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      {
        name: 'ListGroups Test Org',
      },
      bearerAuth(token)
    );

    // Now call listGroups - should return empty array (no groups assigned yet)
    const resp = await trpcQuery(
      integration.baseUrl,
      'requests.listGroups',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 200);
    const { data } = (await parseTRPC(resp)) as { data: any[] };
    assert.ok(Array.isArray(data), 'listGroups should return an array');
  });

  // =========================================
  // New Gateway Endpoint Tests (Session 2026-02-07)
  // =========================================

  // NOTE: auth.me, healthcheck.systemInfo, and apiTokens endpoints forward to OpenPath API
  // which is not running in the gateway-only integration test environment.
  // These are tested via E2E tests where the full stack is running.

  test('/cp/trpc/auth.me requires OpenPath API (expected to fail without it)', async () => {
    const userId = 'user-auth-me-test';
    const email = uniqueEmail('authme');
    const userName = 'Auth Me Test User';

    // Setup: Create user in OpenPath
    await openpathDb
      .insert(openpathSchema.users)
      .values({
        id: userId,
        email,
        name: userName,
        passwordHash: 'hashed',
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: userName,
      roles: [],
    });

    // Create organization to establish tenant context
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Auth Me Test Org' },
      bearerAuth(token)
    );

    // Call auth.me - this forwards to OpenPath API which isn't running
    // So we expect a 500 error (service unavailable)
    const resp = await trpcQuery(integration.baseUrl, 'auth.me', undefined, bearerAuth(token));
    // Without OpenPath API, this will return 500
    assert.ok(
      resp.status === 200 || resp.status === 500,
      'auth.me should return 200 (with OpenPath) or 500 (without)'
    );
  });

  test('/cp/trpc/healthcheck.systemInfo degrades gracefully when OpenPath API is unavailable', async () => {
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
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'Healthcheck Test User',
      roles: [],
    });

    // Create organization
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Healthcheck Test Org' },
      bearerAuth(token)
    );

    // Call healthcheck.systemInfo - this forwards to OpenPath API.
    // If upstream is unavailable, gateway should return fallback data (200), not 500.
    const resp = await trpcQuery(
      integration.baseUrl,
      'healthcheck.systemInfo',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 200, 'healthcheck.systemInfo should always return 200 with fallback');
    const parsed = (await parseTRPC(resp)) as {
      data?: {
        version?: string;
        database?: { connected?: boolean; type?: string };
        session?: {
          accessTokenExpiry?: string;
          accessTokenExpiryHuman?: string;
          refreshTokenExpiry?: string;
          refreshTokenExpiryHuman?: string;
        };
        uptime?: number;
      };
    };
    assert.ok(parsed.data, 'healthcheck.systemInfo should return data payload');
    assert.equal(typeof parsed.data?.version, 'string');
    assert.equal(typeof parsed.data?.database?.connected, 'boolean');
    assert.equal(typeof parsed.data?.database?.type, 'string');
    assert.equal(typeof parsed.data?.session?.accessTokenExpiry, 'string');
    assert.equal(typeof parsed.data?.session?.refreshTokenExpiry, 'string');
    assert.equal(typeof parsed.data?.uptime, 'number');
  });

  test('/cp/trpc/apiTokens.list degrades gracefully when OpenPath API is unavailable', async () => {
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
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'API Tokens Test User',
      roles: [],
    });

    // Create organization
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'API Tokens Test Org' },
      bearerAuth(token)
    );

    // Call apiTokens.list - this forwards to OpenPath API.
    // If upstream is unavailable, gateway should return [] (200), not 500.
    const resp = await trpcQuery(
      integration.baseUrl,
      'apiTokens.list',
      undefined,
      bearerAuth(token)
    );
    assertStatus(resp, 200, 'apiTokens.list should return 200 with fallback []');
    const parsed = (await parseTRPC(resp)) as { data?: unknown };
    assert.ok(Array.isArray(parsed.data), 'apiTokens.list fallback should be an array');
  });

  test('/cp/trpc/apiTokens.create requires OpenPath API (expected to fail without it)', async () => {
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
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'API Tokens Create Test User',
      roles: [],
    });

    // Create organization
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'API Tokens Create Test Org' },
      bearerAuth(token)
    );

    // Create an API token - this forwards to OpenPath API
    const createResp = await trpcMutate(
      integration.baseUrl,
      'apiTokens.create',
      { name: 'Test Token', expiresInDays: 30 },
      bearerAuth(token)
    );
    // Without OpenPath API, this will return 500
    assert.ok(
      createResp.status === 200 || createResp.status === 500,
      'apiTokens.create should return 200 (with OpenPath) or 500 (without)'
    );
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
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'Groups Counts Test User',
      roles: [],
    });

    // Create organization
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Groups Counts Test Org' },
      bearerAuth(token)
    );

    // Create a group
    const createResp = await trpcMutate(
      integration.baseUrl,
      'groups.create',
      { name: 'test-group-counts', displayName: 'Test Group with Counts' },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);
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
      })
      .onConflictDoNothing();

    const token = signToken({
      jwtSecret: JWT_SECRET,
      userId: userId,
      email,
      name: 'System Status Test User',
      roles: [],
    });

    // Create organization
    await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'System Status Test Org' },
      bearerAuth(token)
    );

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
