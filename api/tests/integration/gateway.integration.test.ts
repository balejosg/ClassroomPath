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
        await new Promise(resolve => setTimeout(resolve, 1000));
    });

    after(async () => {
        if (server !== undefined) {
            server.close();
        }
        await closeConnection();
        await closeOpenPathConnection();
    });

    test('should return 401 for unauthenticated requests to /cp/trpc', async () => {
        const resp = await trpcQuery(API_URL, 'onboarding.status');
        const { error } = await parseTRPC(resp) as { error: string };
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

        const token = jwt.sign({
            sub: userId,
            email,
            name: 'Test User',
            roles: []
        }, JWT_SECRET);

        // 1. Check status (should be not onboarded)
        const statusResp = await trpcQuery(API_URL, 'onboarding.status', undefined, bearerAuth(token));
        assertStatus(statusResp, 200);
        const { data: status } = await parseTRPC(statusResp) as { data: any };
        assert.strictEqual(status.hasMembership, false);

        // 2. Create organization
        const createResp = await trpcMutate(API_URL, 'onboarding.createOrganization', {
            name: 'Test Organization'
        }, bearerAuth(token));
        assertStatus(createResp, 200);

        // 3. Verify status now shows membership
        const newStatusResp = await trpcQuery(API_URL, 'onboarding.status', undefined, bearerAuth(token));
        const { data: newStatus } = await parseTRPC(newStatusResp) as { data: any };
        assert.strictEqual(newStatus.hasMembership, true);
        assert.strictEqual(newStatus.organization.name, 'Test Organization');
    });

    test('should block direct access to sensitive OpenPath procedures', async () => {
        // Procedure 'groups.list' is in BLOCKED_OPENPATH_PROCEDURES in server.ts
        const resp = await fetch(`${API_URL}/trpc/groups.list`);
        assert.strictEqual(resp.status, 403);
        const json = await resp.json() as any;
        assert.strictEqual(json.error.message, 'Use /cp/trpc for tenant-scoped data');
    });

    test('should route /cp/health correctly', async () => {
        const resp = await fetch(`${API_URL}/cp/health`);
        assert.strictEqual(resp.status, 200);
        const json = await resp.json() as any;
        assert.strictEqual(json.service, 'classroompath-gateway');
    });

    test('should block requests.list on /trpc (requires /cp/trpc)', async () => {
        const resp = await fetch(`${API_URL}/trpc/requests.list`);
        assert.strictEqual(resp.status, 403);
        const json = await resp.json() as any;
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
        const json = await resp.json() as any;
        assert.strictEqual(json.error.data.blocked, 'requests.approve');
    });

    test('should block requests.reject mutation on /trpc', async () => {
        const resp = await fetch(`${API_URL}/trpc/requests.reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(resp.status, 403);
        const json = await resp.json() as any;
        assert.strictEqual(json.error.data.blocked, 'requests.reject');
    });

    test('should block requests.delete mutation on /trpc', async () => {
        const resp = await fetch(`${API_URL}/trpc/requests.delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.strictEqual(resp.status, 403);
        const json = await resp.json() as any;
        assert.strictEqual(json.error.data.blocked, 'requests.delete');
    });

    test('should block requests.listGroups on /trpc', async () => {
        const resp = await fetch(`${API_URL}/trpc/requests.listGroups`);
        assert.strictEqual(resp.status, 403);
        const json = await resp.json() as any;
        assert.strictEqual(json.error.data.blocked, 'requests.listGroups');
    });

    test('should block batched requests containing blocked procedures', async () => {
        // tRPC batch format: /trpc/proc1,proc2
        const resp = await fetch(`${API_URL}/trpc/health.check,requests.list`);
        assert.strictEqual(resp.status, 403);
        const json = await resp.json() as any;
        assert.strictEqual(json.error.data.blocked, 'requests.list');
    });

    test('/cp/trpc/requests.listGroups should work for authenticated tenant user', async () => {
        // Create a user with organization membership
        const userId = 'user-listgroups-test';
        const email = uniqueEmail('listgroups');

        // Setup: Create user in OpenPath
        await openpathDb.insert(openpathSchema.users).values({
            id: userId,
            email,
            name: 'ListGroups Test User',
            passwordHash: 'hashed',
        }).onConflictDoNothing();

        const token = jwt.sign({
            sub: userId,
            email,
            name: 'ListGroups Test User',
            roles: []
        }, JWT_SECRET);

        // Create organization first
        await trpcMutate(API_URL, 'onboarding.createOrganization', {
            name: 'ListGroups Test Org'
        }, bearerAuth(token));

        // Now call listGroups - should return empty array (no groups assigned yet)
        const resp = await trpcQuery(API_URL, 'requests.listGroups', undefined, bearerAuth(token));
        assertStatus(resp, 200);
        const { data } = await parseTRPC(resp) as { data: any[] };
        assert.ok(Array.isArray(data), 'listGroups should return an array');
    });
});
