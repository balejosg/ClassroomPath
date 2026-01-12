import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
});

export const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    const { db } = await import('../db/index.js');
    const { cpMemberships } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');

    const membership = await db.select()
        .from(cpMemberships)
        .where(eq(cpMemberships.userId, ctx.user.sub))
        .limit(1);

    if (!membership.length) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'No organization membership found'
        });
    }

    return next({
        ctx: {
            ...ctx,
            organizationId: membership[0].organizationId,
            userRole: membership[0].role
        }
    });
});
