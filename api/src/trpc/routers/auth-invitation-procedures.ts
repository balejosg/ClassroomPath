import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure } from '../trpc.js';
import { callOpenPathTrpc } from '../../lib/openpath/trpc-client.js';
import { loginOpenPathUser, registerOpenPathUser } from '../../lib/openpath/auth-client.js';
import { getOpenPathMeProfile } from '../../lib/openpath-auth-client.js';
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

async function getAuthenticatedInvitationUser(params: {
  ctx: {
    user: { sub: string; email: string; name: string } | null;
    token: string | null;
    req: unknown;
  };
  invitation: Awaited<ReturnType<typeof getInvitationOrThrow>>;
}) {
  if (!params.ctx.user || !params.ctx.token) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Inicia sesión con la cuenta invitada para aceptar esta invitación.',
    });
  }

  if (params.ctx.user.email.trim().toLowerCase() !== params.invitation.email) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Debes iniciar sesión con el correo invitado para aceptar esta invitación.',
    });
  }

  const profile = await getOpenPathMeProfile({
    req: params.ctx.req as Parameters<typeof getOpenPathMeProfile>[0]['req'],
    token: params.ctx.token,
  });

  return profile.user;
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
        const existingUser = await getAuthenticatedInvitationUser({
          ctx: {
            user: ctx.user,
            token: ctx.token,
            req: ctx.req,
          },
          invitation,
        });

        await recordTermsAcceptance({
          userId: existingUser.id,
          termsVersion: input.termsVersion,
        });

        await acceptOrganizationInvitation({
          invitationId: invitation.id,
          organizationId: invitation.organizationId,
          userId: existingUser.id,
          invitedBy: invitation.invitedBy,
          role: invitation.role,
        });

        await synchronizeOpenPathRole({
          userId: existingUser.id,
          actedBy: invitation.invitedBy,
        });

        return toAcceptedInvitationUser(existingUser);
      }

      if (!input.password) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Debes crear una contraseña para activar esta invitación.',
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
};
