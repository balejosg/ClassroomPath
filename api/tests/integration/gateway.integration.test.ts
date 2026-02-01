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
});
