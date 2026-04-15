import { z } from 'zod';

import { createTenantAdminProcedure, router } from '../trpc.js';
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
import {
  listOrganizationMutationOperations,
  retryOrganizationMutationOperation,
} from '../../services/cross-system-reconciliation.service.js';

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

const organizationUserAdminProcedure = createTenantAdminProcedure(
  'Only organization admins can manage users'
);

export const usersRouter = router({
  list: organizationUserAdminProcedure.query(async ({ ctx }) => {
    return listOrganizationUsers(ctx.organizationId);
  }),

  listInvitations: organizationUserAdminProcedure.query(async ({ ctx }) => {
    return listOrganizationInvitations(ctx.organizationId);
  }),

  listMutationOperations: organizationUserAdminProcedure
    .input(
      z.object({ status: z.enum(['in_progress', 'completed', 'failed']).optional() }).optional()
    )
    .query(async ({ ctx, input }) => {
      return listOrganizationMutationOperations({
        organizationId: ctx.organizationId,
        status: input?.status,
      });
    }),

  getById: organizationUserAdminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return getOrganizationUserById({ organizationId: ctx.organizationId, userId: input.id });
    }),

  getRole: organizationUserAdminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getOrganizationUserRole({ organizationId: ctx.organizationId, userId: input.userId });
    }),

  create: organizationUserAdminProcedure
    .input(CreateUserSchema)
    .mutation(async ({ ctx, input }) => {
      return createOrganizationUser({
        organizationId: ctx.organizationId,
        actedBy: ctx.user.sub,
        email: input.email,
        name: input.name,
        role: input.role,
      });
    }),

  update: organizationUserAdminProcedure
    .input(UpdateUserSchema)
    .mutation(async ({ ctx, input }) => {
      return updateOrganizationUser({
        organizationId: ctx.organizationId,
        userId: input.id,
        name: input.name,
        active: input.active,
      });
    }),

  delete: organizationUserAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteOrganizationUser({
        organizationId: ctx.organizationId,
        userId: input.id,
        actedBy: ctx.user.sub,
      });
    }),

  revokeInvitation: organizationUserAdminProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return revokeOrganizationInvitation({
        organizationId: ctx.organizationId,
        invitationId: input.invitationId,
        actedBy: ctx.user.sub,
      });
    }),

  retryMutationOperation: organizationUserAdminProcedure
    .input(z.object({ operationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return retryOrganizationMutationOperation({
        organizationId: ctx.organizationId,
        operationId: input.operationId,
        actedBy: ctx.user.sub,
      });
    }),

  assignRole: organizationUserAdminProcedure
    .input(AssignRoleSchema)
    .mutation(async ({ ctx, input }) => {
      return assignOrganizationUserRole({
        organizationId: ctx.organizationId,
        userId: input.userId,
        actedBy: ctx.user.sub,
        role: input.role,
        groupIds: input.groupIds,
      });
    }),

  revokeRole: organizationUserAdminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return revokeOrganizationUserRole({
        organizationId: ctx.organizationId,
        userId: input.userId,
        actedBy: ctx.user.sub,
      });
    }),
});
