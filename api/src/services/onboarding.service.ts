import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';

export interface OnboardingStatus {
    hasMembership: boolean;
    isWaiting: boolean;
    organization: {
        id: string;
        name: string;
        role: string;
    } | null;
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
    // Check for membership
    const membership = await db
        .select({
            orgId: schema.cpMemberships.organizationId,
            role: schema.cpMemberships.role,
            orgName: schema.cpOrganizations.name,
        })
        .from(schema.cpMemberships)
        .innerJoin(
            schema.cpOrganizations,
            eq(schema.cpMemberships.organizationId, schema.cpOrganizations.id)
        )
        .where(eq(schema.cpMemberships.userId, userId))
        .limit(1);

    if (membership.length > 0) {
        return {
            hasMembership: true,
            isWaiting: false,
            organization: {
                id: membership[0].orgId,
                name: membership[0].orgName,
                role: membership[0].role,
            },
        };
    }

    // Check if user is waiting
    const status = await db
        .select()
        .from(schema.cpUserStatus)
        .where(eq(schema.cpUserStatus.userId, userId))
        .limit(1);

    return {
        hasMembership: false,
        isWaiting: status.length > 0 && status[0].status === 'waiting',
        organization: null,
    };
}

export async function createOrganization(
    name: string,
    userId: string
): Promise<{ organizationId: string; membershipId: string }> {
    const orgId = generateId('org');
    const membershipId = generateId('mem');
    const roleId = `role_${generateId('')}`;

    await db.transaction(async (tx) => {
        // Create organization
        await tx.insert(schema.cpOrganizations).values({
            id: orgId,
            name,
            createdBy: userId,
        });

        // Create admin membership for creator
        await tx.insert(schema.cpMemberships).values({
            id: membershipId,
            userId,
            organizationId: orgId,
            role: 'admin',
            invitedBy: null,
        });

        // Remove waiting status if exists
        await tx
            .delete(schema.cpUserStatus)
            .where(eq(schema.cpUserStatus.userId, userId));
    });

    try {
        const existing = await openpathDb.select()
            .from(openpathSchema.roles)
            .where(and(
                eq(openpathSchema.roles.userId, userId),
                eq(openpathSchema.roles.role, 'admin')
            ))
            .limit(1);

        if (existing.length === 0) {
            await openpathDb.insert(openpathSchema.roles).values({
                id: roleId,
                userId,
                role: 'openpath-admin',
                groupIds: [],
                createdBy: userId,
            });
        }
    } catch (error) {
        console.error('Failed to assign admin role in OpenPath:', error);
    }

    return { organizationId: orgId, membershipId };
}

export async function setWaitingStatus(userId: string): Promise<void> {
    await db
        .insert(schema.cpUserStatus)
        .values({
            userId,
            status: 'waiting',
        })
        .onConflictDoUpdate({
            target: schema.cpUserStatus.userId,
            set: { status: 'waiting', updatedAt: new Date() },
        });
}

export async function clearWaitingStatus(userId: string): Promise<void> {
    await db
        .delete(schema.cpUserStatus)
        .where(eq(schema.cpUserStatus.userId, userId));
}
