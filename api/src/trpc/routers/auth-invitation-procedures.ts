import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, publicProcedure } from '../trpc.js';
import { apiCopy } from '../../lib/api-content.js';
import { callOpenPathTrpc } from '../../lib/openpath/trpc-client.js';
import { loginOpenPathUser, registerOpenPathUser } from '../../lib/openpath/auth-client.js';
import { synchronizeOpenPathRole } from '../../lib/openpath-roles.js';
import { storeSessionFromPayload } from '../../lib/session-cookies.js';
import {
  acceptOrganizationInvitation,
  getActiveInvitationByEmail,
  getInvitationByToken,
} from '../../services/invitations.service.js';
import { recordTermsAcceptance } from '../../services/legal-consent.service.js';
import { assertCurrentTermsVersion, normalizeEmailAddress } from './auth-payloads.js';
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

function getAuthenticatedInvitationUser(params: {
  user: { sub: string; email: string; name: string } | null;
  invitation: Awaited<ReturnType<typeof getInvitationOrThrow>>;
}) {
  if (!params.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: apiCopy.en.errors.invitationLoginRequired,
    });
  }

  if (normalizeEmailAddress(params.user.email) !== params.invitation.email) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: apiCopy.en.errors.invitationEmailMismatch,
    });
  }

  return {
    id: params.user.sub,
    email: normalizeEmailAddress(params.user.email),
    name: params.user.name,
  };
}

function toAcceptedInvitationUser(user: { id: string; email: string; name: string }) {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };
}

async function acceptInvitationForExistingUser(params: {
  invitation: Awaited<ReturnType<typeof getInvitationOrThrow>>;
  termsVersion: string;
  user: { id: string; email: string; name: string };
}) {
  await recordTermsAcceptance({
    userId: params.user.id,
    termsVersion: params.termsVersion,
  });

  await acceptOrganizationInvitation({
    invitationId: params.invitation.id,
    organizationId: params.invitation.organizationId,
    userId: params.user.id,
    invitedBy: params.invitation.invitedBy,
    role: params.invitation.role,
  });

  await synchronizeOpenPathRole({
    userId: params.user.id,
    actedBy: params.invitation.invitedBy,
  });

  return toAcceptedInvitationUser(params.user);
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
        password: z.string().min(8).optional(),
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
        clientMode: clientModeInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const invitation = await getInvitationOrThrow(input.token);

      assertCurrentTermsVersion(input.termsVersion);

      if (invitation.hasExistingAccount) {
        const existingUser = getAuthenticatedInvitationUser({
          user: ctx.user,
          invitation,
        });

        return acceptInvitationForExistingUser({
          invitation,
          termsVersion: input.termsVersion,
          user: existingUser,
        });
      }

      if (!input.password) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: apiCopy.en.errors.invitationPasswordRequired,
        });
      }

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

  acceptPendingInvitation: protectedProcedure
    .input(
      z.object({
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
        clientMode: clientModeInput,
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertCurrentTermsVersion(input.termsVersion);

      const email = normalizeEmailAddress(ctx.user.email);
      const invitation = await getActiveInvitationByEmail({ email });

      if (!invitation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: apiCopy.en.errors.noPendingInvitation,
        });
      }

      const existingUser = getAuthenticatedInvitationUser({
        user: ctx.user,
        invitation,
      });

      return acceptInvitationForExistingUser({
        invitation,
        termsVersion: input.termsVersion,
        user: existingUser,
      });
    }),
};
