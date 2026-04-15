import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';
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
