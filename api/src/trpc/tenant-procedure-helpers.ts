import { TRPCError } from '@trpc/server';

import type { Context } from './context.js';
import { requireTeacherOrAdmin } from '../lib/tenant-access.js';

type AuthenticatedProcedureContext = Context & {
  user: NonNullable<Context['user']>;
};

export type TenantProcedureContext = AuthenticatedProcedureContext & {
  organizationId: string;
  userRole: string;
};

export type TeacherOrAdminTenantProcedureContext = TenantProcedureContext & {
  userRole: 'admin' | 'teacher';
};

export type AdminTenantProcedureContext = TenantProcedureContext & {
  userRole: 'admin';
};

export function assertTenantProcedureContext(ctx: Context): asserts ctx is TenantProcedureContext {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }

  if (!ctx.organizationId || !ctx.userRole) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing tenant context' });
  }
}

export function assertTeacherOrAdminTenantProcedureContext(
  ctx: Context
): asserts ctx is TeacherOrAdminTenantProcedureContext {
  assertTenantProcedureContext(ctx);
  requireTeacherOrAdmin(ctx);
}

export function assertOrgAdminTenantProcedureContext(
  ctx: Context,
  message = 'Admin access required'
): asserts ctx is AdminTenantProcedureContext {
  assertTenantProcedureContext(ctx);

  if (ctx.userRole !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}
