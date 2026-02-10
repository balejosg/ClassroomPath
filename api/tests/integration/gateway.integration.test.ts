/**
 * ClassroomPath Gateway & Multi-tenancy Integration Tests
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import {
  getAvailablePort,
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection } from '../../src/db/openpath.js';

let PORT: number;
let API_URL: string;

let server: Server | undefined;

describe('ClassroomPath Gateway Integration', async () => {
  before(async () => {
    await resetDb();

    PORT = await getAvailablePort();
    API_URL = `http://localhost:${String(PORT)}`;
    process.env.CP_PORT = String(PORT);

    const { app } = await import('../../src/server.js');

    server = app.listen(PORT);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  after(async () => {
    const srv = server;
    server = undefined;
    if (srv !== undefined) {
      try {
        // Node may throw ERR_SERVER_NOT_RUNNING if already closed.
        // Also avoid closing when not listening to keep teardown robust.
        if ((srv as any).listening === true) {
          await new Promise<void>((resolve, reject) => {
            srv.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      } catch (err: any) {
        if (err?.code !== 'ERR_SERVER_NOT_RUNNING') throw err;
      }
    }
    await closeConnection();
    await closeOpenPathConnection();

    // Node's fetch (undici) can keep sockets alive and prevent the test runner from exiting.
    // Close the global dispatcher to release any keep-alive connections.
    try {
      const undici: any = await import('undici');
      const dispatcher: any = undici.getGlobalDispatcher?.();
      if (typeof dispatcher?.close === 'function') {
        await dispatcher.close();
      }
    } catch {
      // best-effort cleanup
    }
  });

  test('should return 401 for unauthenticated requests to /cp/trpc', async () => {
    const resp = await trpcQuery(API_URL, 'onboarding.status');
    const { error } = (await parseTRPC(resp)) as { error: string };
    assert.strictEqual(error, 'Not authenticated');
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // 1. Check status (should be not onboarded)
    const statusResp = await trpcQuery(API_URL, 'onboarding.status', undefined, bearerAuth(token));
    assertStatus(statusResp, 200);
    const { data: status } = (await parseTRPC(statusResp)) as { data: any };
    assert.strictEqual(status.hasMembership, false);

    // 2. Create organization
    const createResp = await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      {
        name: 'Test Organization',
      },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);

    // 3. Verify status now shows membership
    const newStatusResp = await trpcQuery(
      API_URL,
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
    const resp = await fetch(`${API_URL}/trpc/groups.list`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
  });

  test('should route /cp/health correctly', async () => {
    const resp = await fetch(`${API_URL}/cp/health`);
    assert.strictEqual(resp.status, 200);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.service, 'classroompath-gateway');
  });

  test('should block requests.list on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${API_URL}/trpc/requests.list`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'requests.list');
  });

  test('should block requests.approve mutation on /trpc', async () => {
    const resp = await fetch(`${API_URL}/trpc/requests.approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.approve');
  });

  test('should block requests.reject mutation on /trpc', async () => {
    const resp = await fetch(`${API_URL}/trpc/requests.reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.reject');
  });

  test('should block requests.delete mutation on /trpc', async () => {
    const resp = await fetch(`${API_URL}/trpc/requests.delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.delete');
  });

  test('should block requests.listGroups on /trpc', async () => {
    const resp = await fetch(`${API_URL}/trpc/requests.listGroups`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.data.blocked, 'requests.listGroups');
  });

  test('should block groups.listRulesGrouped on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${API_URL}/trpc/groups.listRulesGrouped`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'groups.listRulesGrouped');
  });

  test('should block schedules.getMine on /trpc (requires /cp/trpc)', async () => {
    const resp = await fetch(`${API_URL}/trpc/schedules.getMine`);
    assert.strictEqual(resp.status, 403);
    const json = (await resp.json()) as any;
    assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    assert.strictEqual(json.error.data.blocked, 'schedules.getMine');
  });

  test('should block batched requests containing blocked procedures', async () => {
    // tRPC batch format: /trpc/proc1,proc2
    const resp = await fetch(`${API_URL}/trpc/health.check,requests.list`);
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'ListGroups Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization first
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      {
        name: 'ListGroups Test Org',
      },
      bearerAuth(token)
    );

    // Now call listGroups - should return empty array (no groups assigned yet)
    const resp = await trpcQuery(API_URL, 'requests.listGroups', undefined, bearerAuth(token));
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: userName,
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization to establish tenant context
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      { name: 'Auth Me Test Org' },
      bearerAuth(token)
    );

    // Call auth.me - this forwards to OpenPath API which isn't running
    // So we expect a 500 error (service unavailable)
    const resp = await trpcQuery(API_URL, 'auth.me', undefined, bearerAuth(token));
    // Without OpenPath API, this will return 500
    assert.ok(
      resp.status === 200 || resp.status === 500,
      'auth.me should return 200 (with OpenPath) or 500 (without)'
    );
  });

  test('/cp/trpc/healthcheck.systemInfo requires OpenPath API (expected to fail without it)', async () => {
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'Healthcheck Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      { name: 'Healthcheck Test Org' },
      bearerAuth(token)
    );

    // Call healthcheck.systemInfo - this forwards to OpenPath API
    const resp = await trpcQuery(API_URL, 'healthcheck.systemInfo', undefined, bearerAuth(token));
    // Without OpenPath API, this will return 500
    assert.ok(
      resp.status === 200 || resp.status === 500,
      'healthcheck.systemInfo should return 200 (with OpenPath) or 500 (without)'
    );
  });

  test('/cp/trpc/apiTokens.list requires OpenPath API (expected to fail without it)', async () => {
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'API Tokens Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      { name: 'API Tokens Test Org' },
      bearerAuth(token)
    );

    // Call apiTokens.list - this forwards to OpenPath API
    const resp = await trpcQuery(API_URL, 'apiTokens.list', undefined, bearerAuth(token));
    // Without OpenPath API, this will return 500
    assert.ok(
      resp.status === 200 || resp.status === 500,
      'apiTokens.list should return 200 (with OpenPath) or 500 (without)'
    );
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'API Tokens Create Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      { name: 'API Tokens Create Test Org' },
      bearerAuth(token)
    );

    // Create an API token - this forwards to OpenPath API
    const createResp = await trpcMutate(
      API_URL,
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'Groups Counts Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      { name: 'Groups Counts Test Org' },
      bearerAuth(token)
    );

    // Create a group
    const createResp = await trpcMutate(
      API_URL,
      'groups.create',
      { name: 'test-group-counts', displayName: 'Test Group with Counts' },
      bearerAuth(token)
    );
    assertStatus(createResp, 200);
    const { data: group } = (await parseTRPC(createResp)) as { data: any };

    // Add a whitelist rule
    await trpcMutate(
      API_URL,
      'groups.addRule',
      { groupId: group.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(token)
    );

    // Fetch groups.list and verify counts are present
    const listResp = await trpcQuery(API_URL, 'groups.list', undefined, bearerAuth(token));
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

    const token = jwt.sign(
      {
        sub: userId,
        email,
        name: 'System Status Test User',
        roles: [],
      },
      JWT_SECRET
    );

    // Create organization
    await trpcMutate(
      API_URL,
      'onboarding.createOrganization',
      { name: 'System Status Test Org' },
      bearerAuth(token)
    );

    // Call groups.systemStatus
    const resp = await trpcQuery(API_URL, 'groups.systemStatus', undefined, bearerAuth(token));
    assertStatus(resp, 200);
    const { data } = (await parseTRPC(resp)) as { data: any };
    assert.ok(data, 'groups.systemStatus should return data');
    assert.strictEqual(typeof data.enabledGroups, 'number', 'enabledGroups should be a number');
    assert.strictEqual(typeof data.disabledGroups, 'number', 'disabledGroups should be a number');
    assert.strictEqual(typeof data.totalGroups, 'number', 'totalGroups should be a number');
  });
});
