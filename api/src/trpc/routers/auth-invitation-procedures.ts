import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure } from '../trpc.js';
import { callOpenPathTrpc } from '../../lib/openpath-upstream.js';
import { synchronizeOpenPathRole } from '../../lib/openpath-roles.js';
import { storeSessionFromPayload } from '../../lib/session-cookies.js';
import {
  acceptOrganizationInvitation,
  getInvitationByToken,
} from '../../services/invitations.service.js';
import { recordTermsAcceptance } from '../../services/legal-consent.service.js';
import {
  assertCurrentTermsVersion,
  parseOpenPathRegistrationPayload,
  parseOpenPathSessionPayload,
} from './auth-payloads.js';

async function getInvitationOrThrow(token: string) {
  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Invitation not found or expired',
    });
  }

  return invitation;
}

export const authInvitationProcedures = {
  getInvitation: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      })
    )
    .query(async ({ input }) => getInvitationOrThrow(input.token)),

  acceptInvitation: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        password: z.string().min(8),
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const invitation = await getInvitationOrThrow(input.token);

      assertCurrentTermsVersion(input.termsVersion);

      const registrationPayload = await callOpenPathTrpc({
        procedure: 'auth.register',
        req: ctx.req,
        input: {
          email: invitation.email,
          name: invitation.name,
          password: input.password,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Registration service unavailable',
      });

      const registration = parseOpenPathRegistrationPayload(registrationPayload);

      await recordTermsAcceptance({
        userId: registration.user.id,
        termsVersion: input.termsVersion,
      });

      await callOpenPathTrpc({
        procedure: 'auth.verifyEmail',
        req: ctx.req,
        input: {
          email: invitation.email,
          token: registration.verificationToken,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Authentication service unavailable',
      });

      await acceptOrganizationInvitation({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        userId: registration.user.id,
        invitedBy: invitation.invitedBy,
        role: invitation.role,
      });

      await synchronizeOpenPathRole({
        userId: registration.user.id,
        actedBy: invitation.invitedBy,
        groupIds: [],
      });

      const loginPayload = await callOpenPathTrpc({
        procedure: 'auth.login',
        req: ctx.req,
        input: {
          email: invitation.email,
          password: input.password,
        },
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Authentication service unavailable',
      });

      const sessionPayload = parseOpenPathSessionPayload(loginPayload);
      return storeSessionFromPayload(ctx.res, sessionPayload);
    }),
};
