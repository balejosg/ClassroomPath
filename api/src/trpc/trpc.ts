import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';
import { getSingleMembershipOrThrow } from '../lib/tenant-memberships.js';

const t = initTRPC.context<Context>().create();

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

export const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const membership = await getSingleMembershipOrThrow(ctx.user.sub);

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No organization membership found',
    });
  }

  return next({
    ctx: {
      ...ctx,
      organizationId: membership.organizationId,
      userRole: membership.role,
    },
  });
});
