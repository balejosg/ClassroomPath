import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as onboardingService from '../../services/onboarding.service.js';
import * as openpathRoles from '../../lib/openpath-roles.js';
import * as openpathUsers from '../../lib/openpath-users.js';
import * as jwt from '../../lib/jwt.js';
import * as pendingUsersService from '../../services/pending-users.service.js';
import { db, schema } from '../../db/index.js';
import { config } from '../../config.js';
import { setSessionCookies } from '../../lib/session-cookies.js';

export const onboardingRouter = router({
  /**
   * List all organizations (for users to select which one to join)
   */
  listOrganizations: protectedProcedure.query(async () => {
    if (!config.allowOrgDirectory) {
      return [];
    }

    const orgs = await db
      .select({
        id: schema.cpOrganizations.id,
        name: schema.cpOrganizations.name,
      })
      .from(schema.cpOrganizations);

    return orgs;
  }),
  /**
   * Get current user's onboarding status
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    return onboardingService.getOnboardingStatus(ctx.user.sub);
  }),

  /**
   * Create a new organization (user becomes admin)
   */
  createOrganization: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!config.allowSelfServiceOrgs) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'La creación de organizaciones está deshabilitada',
        });
      }

      await onboardingService.assertCanStartOnboarding(ctx.user.sub);

      const result = await onboardingService.createOrganization(input.name, ctx.user.sub);

      const user = await openpathUsers.getUserById(ctx.user.sub);
      if (!user) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'User not found after organization creation',
        });
      }

      const roles = await openpathRoles.getUserRoles(ctx.user.sub);
      const tokens = jwt.generateTokens(user, roles);
      setSessionCookies(ctx.res, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });

      return {
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
      };
    }),

  /**
   * Mark user as waiting for invitation to a specific organization
   */
  waitForInvitation: protectedProcedure
    .input(
      z
        .object({
          targetOrganizationId: z.string().min(1).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      await onboardingService.assertCanStartOnboarding(ctx.user.sub);

      const targetOrgId = input?.targetOrganizationId;

      if (targetOrgId) {
        // Verify organization exists
        const org = await db
          .select()
          .from(schema.cpOrganizations)
          .where(eq(schema.cpOrganizations.id, targetOrgId))
          .limit(1);

        if (org.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Organization not found',
          });
        }

        await pendingUsersService.setWaitingStatusWithOrg(ctx.user.sub, targetOrgId);
      } else {
        const orgs = await db
          .select({ id: schema.cpOrganizations.id })
          .from(schema.cpOrganizations)
          .limit(2);

        if (orgs.length === 1) {
          await pendingUsersService.setWaitingStatusWithOrg(ctx.user.sub, orgs[0].id);
        } else if (orgs.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No hay organizaciones disponibles',
          });
        } else if (!config.allowOrgDirectory) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'El directorio de organizaciones está deshabilitado. Solicita una invitación directa a tu administrador',
          });
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Debes seleccionar una organización para solicitar acceso',
          });
        }
      }

      return { success: true };
    }),

  /**
   * Clear waiting status (user wants to create org instead)
   */
  cancelWaiting: protectedProcedure.mutation(async ({ ctx }) => {
    await onboardingService.clearWaitingStatus(ctx.user.sub);
    return { success: true };
  }),
});
