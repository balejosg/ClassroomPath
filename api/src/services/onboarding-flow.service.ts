import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { TRPCError } from '@trpc/server';

import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import * as jwt from '../lib/jwt.js';
import { storeSessionFromPayload } from '../lib/session-cookies.js';
import type { SessionClientMode } from '../lib/session-cookies.js';
import { apiCopy } from '../lib/api-content.js';
import * as openpathRoles from '../lib/openpath-roles.js';
import * as openpathUsers from '../lib/openpath-users.js';
import * as onboardingService from './onboarding.service.js';
import * as pendingUsersService from './pending-users.service.js';

export async function listAvailableOrganizations() {
  if (!config.allowOrgDirectory) {
    return [];
  }

  return db
    .select({
      id: schema.cpOrganizations.id,
      name: schema.cpOrganizations.name,
    })
    .from(schema.cpOrganizations);
}

export async function createOrganizationSession(params: {
  name: string;
  userId: string;
  res: Pick<Response, 'cookie'>;
  clientMode: SessionClientMode;
}) {
  if (!config.allowSelfServiceOrgs) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Billing checkout required before creating an organization',
    });
  }

  await onboardingService.assertCanStartOnboarding(params.userId);

  const result = await onboardingService.createOrganization(params.name, params.userId);
  const user = await openpathUsers.getUserById(params.userId);

  if (!user) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'User not found after organization creation',
    });
  }

  const roles = await openpathRoles.getUserRoles(params.userId);
  const tokens = jwt.generateTokens(user, roles);

  return storeSessionFromPayload(
    params.res,
    {
      success: true,
      organizationId: result.organizationId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
      },
    },
    { clientMode: params.clientMode }
  );
}

export async function setWaitingForInvitation(params: {
  userId: string;
  targetOrganizationId?: string;
}) {
  await onboardingService.assertCanStartOnboarding(params.userId);

  if (params.targetOrganizationId) {
    const org = await db
      .select({ id: schema.cpOrganizations.id })
      .from(schema.cpOrganizations)
      .where(eq(schema.cpOrganizations.id, params.targetOrganizationId))
      .limit(1);

    if (org.length === 0) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    await pendingUsersService.setWaitingStatusWithOrg(params.userId, params.targetOrganizationId);
    return { success: true as const };
  }

  const orgs = await db
    .select({ id: schema.cpOrganizations.id })
    .from(schema.cpOrganizations)
    .limit(2);

  if (orgs.length === 1) {
    await pendingUsersService.setWaitingStatusWithOrg(params.userId, orgs[0].id);
    return { success: true as const };
  }

  if (orgs.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: apiCopy.en.errors.noOrganizationsAvailable,
    });
  }

  if (!config.allowOrgDirectory) {
    await onboardingService.setWaitingStatus(params.userId);
    return { success: true as const };
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: apiCopy.en.errors.organizationSelectionRequired,
  });
}

export async function cancelWaitingForInvitation(userId: string) {
  await onboardingService.clearWaitingStatus(userId);
  return { success: true as const };
}
