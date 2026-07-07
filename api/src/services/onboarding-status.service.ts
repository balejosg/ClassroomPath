import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { getUserById, getUserEmailVerificationById } from '../db/openpath-repos/users.repo.js';
import {
  assertNoExistingMembershipOrThrow,
  getSingleMembershipOrThrow,
} from '../lib/tenant-memberships.js';
import {
  createOnboardingPolicy,
  type OnboardingPolicy,
} from '@classroompath/contracts/onboarding-policy';
import type { OnboardingStatusDto } from '@classroompath/presenters/onboarding';
import { getOrganizationBillingStatus, isPlatformAdminEmail } from './billing.service.js';
import { getActiveInvitationByEmail } from './invitations.service.js';

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
  const status = await db
    .select()
    .from(schema.cpUserStatus)
    .where(eq(schema.cpUserStatus.userId, userId))
    .limit(1);

  const user = await getUserById(userId);

  const membership = await getSingleMembershipOrThrow(userId);
  const pendingInvitation = user
    ? await getActiveInvitationByEmail({
        email: user.email,
        targetOrganizationId: status[0]?.targetOrganizationId ?? null,
      })
    : null;

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
      pendingInvitation:
        pendingInvitation && pendingInvitation.organizationId !== membership.organizationId
          ? {
              organizationId: pendingInvitation.organizationId,
              organizationName: pendingInvitation.organizationName,
              role: pendingInvitation.role,
              requiresMigration: true,
            }
          : null,
      platformAdmin: false,
      billing,
      policy,
    };
  }

  return {
    hasMembership: false,
    isWaiting: status.length > 0 && status[0].status === 'waiting',
    organization: null,
    pendingInvitation: pendingInvitation
      ? {
          organizationId: pendingInvitation.organizationId,
          organizationName: pendingInvitation.organizationName,
          role: pendingInvitation.role,
          requiresMigration: false,
        }
      : null,
    platformAdmin: user ? isPlatformAdminEmail(user.email) : false,
    billing: null,
    policy,
  };
}

export async function assertCanStartOnboarding(userId: string): Promise<void> {
  const user = await getUserEmailVerificationById(userId);

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
