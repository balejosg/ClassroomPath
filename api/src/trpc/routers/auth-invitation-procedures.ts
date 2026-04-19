import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure } from '../trpc.js';
import { callOpenPathTrpc } from '../../lib/openpath/trpc-client.js';
import { loginOpenPathUser, registerOpenPathUser } from '../../lib/openpath/auth-client.js';
import { synchronizeOpenPathRole } from '../../lib/openpath-roles.js';
import { storeSessionFromPayload } from '../../lib/session-cookies.js';
import {
  acceptOrganizationInvitation,
  getInvitationByToken,
} from '../../services/invitations.service.js';
import { recordTermsAcceptance } from '../../services/legal-consent.service.js';
import { assertCurrentTermsVersion } from './auth-payloads.js';
import { resolveRegistrationEmailVerification } from './auth-verification-flow.js';

const clientModeInput = z.enum(['web', 'app']).optional();

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
        clientMode: clientModeInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const invitation = await getInvitationOrThrow(input.token);

      assertCurrentTermsVersion(input.termsVersion);

      const registration = await registerOpenPathUser({
        req: ctx.req,
        input: {
          email: invitation.email,
          name: invitation.name,
          password: input.password,
        },
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Registration service unavailable',
      });

      await recordTermsAcceptance({
        userId: registration.user.id,
        termsVersion: input.termsVersion,
      });

      const verification = await resolveRegistrationEmailVerification({ registration });

      await callOpenPathTrpc({
        procedure: 'auth.verifyEmail',
        req: ctx.req,
        input: {
          email: invitation.email,
          token: verification.verificationToken,
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

      const sessionPayload = await loginOpenPathUser({
        req: ctx.req,
        input: {
          email: invitation.email,
          password: input.password,
        },
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Authentication service unavailable',
      });
      return storeSessionFromPayload(ctx.res, sessionPayload, {
        clientMode: input.clientMode ?? 'web',
      });
    }),
};
