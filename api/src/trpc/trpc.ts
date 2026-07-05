import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';
import { getRequestId } from '../lib/request-id.js';
import { logger } from '../lib/logger.js';
import { assertOrganizationEntitled } from '../services/billing.service.js';
import {
  requireOrgAdminTenantProcedureContext,
  requireTeacherOrAdminTenantProcedureContext,
  requireTenantProcedureContext,
} from './tenant-procedure-helpers.js';

export interface TrpcMeta {
  tenantScoped?: boolean;
}

const t = initTRPC
  .context<Context>()
  .meta<TrpcMeta>()
  .create({
    errorFormatter({ shape, ctx }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          requestId: ctx ? getRequestId(ctx.req) : undefined,
        },
      };
    },
  });

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    if (ctx.authFailure) {
      throw new TRPCError({
        code: ctx.authFailure.code,
        message: ctx.authFailure.message,
      });
    }

    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const roles = ctx.user.roles?.map((r) => r.role) || [];
  if (!roles.includes('admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

export const tenantProcedure = protectedProcedure
  .meta({ tenantScoped: true })
  .use(async ({ ctx, next }) => {
    const membership = await getSingleMembershipOrThrow(ctx.user.sub);

    if (!membership) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'No organization membership found',
      });
    }

    await assertOrganizationEntitled(membership.organizationId);

    return next({
      ctx: {
        ...ctx,
        organizationId: membership.organizationId,
        userRole: membership.role,
      },
    });
  });

export const tenantMemberProcedure = tenantProcedure.use(async ({ ctx, next }) => {
  return next({ ctx: requireTenantProcedureContext(ctx) });
});

export const teacherOrAdminProcedure = tenantProcedure.use(async ({ ctx, next }) => {
  return next({ ctx: requireTeacherOrAdminTenantProcedureContext(ctx) });
});

export function createTenantAdminProcedure(message = 'Admin access required') {
  return tenantProcedure.use(async ({ ctx, next }) => {
    return next({
      ctx: requireOrgAdminTenantProcedureContext(ctx, message),
    });
  });
}

export const tenantAdminProcedure = createTenantAdminProcedure();

export function logTrpcError(params: { path?: string; ctx?: Context; error: Error }): void {
  const requestId = params.ctx ? getRequestId(params.ctx.req) : undefined;
  logger.error('tRPC request failed', {
    requestId,
    path: params.path,
    error: params.error.message,
  });
}
