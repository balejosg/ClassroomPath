import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db, schema } from '../src/db/index.js';
import { eq } from 'drizzle-orm';
import * as onboardingService from '../src/services/onboarding.service.js';

const TEST_USER_ID = 'test-user-' + Date.now();

describe('Onboarding Service', () => {
    after(async () => {
        // Cleanup
        await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, TEST_USER_ID));
        await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, TEST_USER_ID));
        // Note: org cleanup would cascade from memberships
    });

    it('should return no membership for new user', async () => {
        const status = await onboardingService.getOnboardingStatus(TEST_USER_ID);
        
        assert.strictEqual(status.hasMembership, false);
        assert.strictEqual(status.isWaiting, false);
        assert.strictEqual(status.organization, null);
    });

    it('should create organization and admin membership', async () => {
        const result = await onboardingService.createOrganization('Test School', TEST_USER_ID);
        
        assert.ok(result.organizationId.startsWith('org_'));
        assert.ok(result.membershipId.startsWith('mem_'));
        
        // Verify membership
        const status = await onboardingService.getOnboardingStatus(TEST_USER_ID);
        assert.strictEqual(status.hasMembership, true);
        assert.strictEqual(status.organization?.name, 'Test School');
        assert.strictEqual(status.organization?.role, 'admin');
    });

    it('should set waiting status', async () => {
        const waitingUserId = TEST_USER_ID + '-waiting';
        
        await onboardingService.setWaitingStatus(waitingUserId);
        
        const status = await onboardingService.getOnboardingStatus(waitingUserId);
        assert.strictEqual(status.hasMembership, false);
        assert.strictEqual(status.isWaiting, true);
        
        // Cleanup
        await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, waitingUserId));
    });

    it('should clear waiting status', async () => {
        const waitingUserId = TEST_USER_ID + '-clear';
        
        await onboardingService.setWaitingStatus(waitingUserId);
        await onboardingService.clearWaitingStatus(waitingUserId);
        
        const status = await onboardingService.getOnboardingStatus(waitingUserId);
        assert.strictEqual(status.isWaiting, false);
    });
});
