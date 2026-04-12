import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, schema } from '../db/index.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';
import { generateId } from '../lib/id.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import { config } from '../config.js';
import {
  getMutationResult,
  getOrCreateMutationOperation,
  setMutationOperationProgress,
  toMutationError,
} from '../lib/cross-system-mutations.js';
import {
  assertNoExistingMembershipOrThrow,
  getSingleMembershipOrThrow,
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
} from '../lib/tenant-memberships.js';
import { synchronizeOpenPathRole } from '../lib/openpath-roles.js';
import {
  createOnboardingPolicy,
  type OnboardingPolicy,
} from '@classroompath/contracts/onboarding-policy';
import type { OnboardingStatusDto } from '@classroompath/presenters/onboarding';
import { getOrganizationBillingStatus, isPlatformAdminEmail } from './billing.service.js';

export type OnboardingStatus = OnboardingStatusDto;

export function getOnboardingPolicy(): OnboardingPolicy {
  return createOnboardingPolicy({
    allowSelfServiceOrgs: config.allowSelfServiceOrgs,
    allowOrgDirectory: config.allowOrgDirectory,
    billingMode: config.billingMode,
  });
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatusDto> {
  const policy = getOnboardingPolicy();
  const membership = await getSingleMembershipOrThrow(userId);
  if (membership) {
    const [organization] = await db
      .select({
        id: schema.cpOrganizations.id,
        name: schema.cpOrganizations.name,
      })
      .from(schema.cpOrganizations)
      .where(eq(schema.cpOrganizations.id, membership.organizationId))
      .limit(1);

    const billing = await getOrganizationBillingStatus(membership.organizationId);

    return {
      hasMembership: true,
      isWaiting: false,
      organization: {
        id: membership.organizationId,
        name: organization?.name ?? membership.organizationId,
        role: membership.role,
      },
      platformAdmin: false,
      billing,
      policy,
    };
  }

  const [user] = await openpathDb
    .select({ email: openpathSchema.users.email })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.id, userId))
    .limit(1);

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
    platformAdmin: user ? isPlatformAdminEmail(user.email) : false,
    billing: null,
    policy,
  };
}

export async function assertCanStartOnboarding(userId: string): Promise<void> {
  const [user] = await openpathDb
    .select({ id: openpathSchema.users.id, emailVerified: openpathSchema.users.emailVerified })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.id, userId))
    .limit(1);

  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
  }

  if (!user.emailVerified) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Email verification required before onboarding',
    });
  }

  await assertNoExistingMembershipOrThrow(userId);
}

export async function createOrganization(
  name: string,
  userId: string
): Promise<{ organizationId: string; membershipId: string }> {
  const operation = await getOrCreateMutationOperation({
    operationType: 'onboarding.create_organization',
    idempotencyKey: userId,
    userId,
    metadata: { name },
  });

  const storedResult = getMutationResult<{ organizationId: string; membershipId: string }>(
    operation
  );
  let localResult = storedResult;

  if (operation.status === 'completed' && localResult) {
    return localResult;
  }

  if (!localResult) {
    await assertCanStartOnboarding(userId);

    const orgId = generateId('org');
    const membershipId = generateId('mem');

    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.cpOrganizations).values({
          id: orgId,
          name,
          createdBy: userId,
        });

        await tx.insert(schema.cpMemberships).values({
          id: membershipId,
          userId,
          organizationId: orgId,
          role: 'admin',
          invitedBy: null,
        });

        await tx.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));

        await setMutationOperationProgress(
          operation.id,
          {
            step: 'local_committed',
            status: 'in_progress',
            organizationId: orgId,
            result: { organizationId: orgId, membershipId },
            metadata: { ...operation.metadata, name },
            lastError: null,
          },
          tx
        );
      });
    } catch (error) {
      await setMutationOperationProgress(operation.id, {
        step: 'failed',
        status: 'failed',
        lastError: toMutationError(error),
      });
      throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
    }

    localResult = { organizationId: orgId, membershipId };
  }

  try {
    await synchronizeOpenPathRole({
      userId,
      actedBy: userId,
      groupIds: [],
    });

    await setMutationOperationProgress(operation.id, {
      step: 'completed',
      status: 'completed',
      organizationId: localResult.organizationId,
      result: localResult,
      lastError: null,
      completed: true,
    });
  } catch (error) {
    await setMutationOperationProgress(operation.id, {
      step: 'failed',
      status: 'failed',
      organizationId: localResult.organizationId,
      result: localResult,
      lastError: toMutationError(error),
    });
    throw error;
  }

  return localResult;
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
  await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, userId));
}
