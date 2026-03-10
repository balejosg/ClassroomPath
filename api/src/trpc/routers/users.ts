import { z } from 'zod';

import { router, tenantProcedure } from '../trpc.js';
import { assertOrgAdminTenantProcedureContext } from '../tenant-procedure-helpers.js';
import {
  assignOrganizationUserRole,
  createOrganizationUser,
  deleteOrganizationUser,
  getOrganizationUserById,
  getOrganizationUserRole,
  listOrganizationInvitations,
  listOrganizationUsers,
  revokeOrganizationUserRole,
  revokeOrganizationInvitation,
  updateOrganizationUser,
} from '../../services/user.service.js';

const CreateUserSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(255),
  role: z.enum(['admin', 'teacher']).default('teacher'),
});

const UpdateUserSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(255).optional(),
  active: z.boolean().optional(),
});

const AssignRoleSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'teacher']),
  groupIds: z.array(z.string()).default([]),
});

export const usersRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return listOrganizationUsers(ctx.organizationId);
  }),

  listInvitations: tenantProcedure.query(async ({ ctx }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return listOrganizationInvitations(ctx.organizationId);
  }),

  getById: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return getOrganizationUserById({ organizationId: ctx.organizationId, userId: input.id });
  }),

  getRole: tenantProcedure.input(z.object({ userId: z.string() })).query(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return getOrganizationUserRole({ organizationId: ctx.organizationId, userId: input.userId });
  }),

  create: tenantProcedure.input(CreateUserSchema).mutation(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return createOrganizationUser({
      organizationId: ctx.organizationId,
      actedBy: ctx.user.sub,
      email: input.email,
      name: input.name,
      role: input.role,
    });
  }),

  update: tenantProcedure.input(UpdateUserSchema).mutation(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return updateOrganizationUser({
      organizationId: ctx.organizationId,
      userId: input.id,
      name: input.name,
      active: input.active,
    });
  }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return deleteOrganizationUser({
      organizationId: ctx.organizationId,
      userId: input.id,
      actedBy: ctx.user.sub,
    });
  }),

  revokeInvitation: tenantProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
      return revokeOrganizationInvitation({
        organizationId: ctx.organizationId,
        invitationId: input.invitationId,
      });
    }),

  assignRole: tenantProcedure.input(AssignRoleSchema).mutation(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
    return assignOrganizationUserRole({
      organizationId: ctx.organizationId,
      userId: input.userId,
      actedBy: ctx.user.sub,
      role: input.role,
      groupIds: input.groupIds,
    });
  }),

  revokeRole: tenantProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
      return revokeOrganizationUserRole({
        organizationId: ctx.organizationId,
        userId: input.userId,
        actedBy: ctx.user.sub,
      });
    }),
});
