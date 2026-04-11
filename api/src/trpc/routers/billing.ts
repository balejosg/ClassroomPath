import { z } from 'zod';

import { protectedProcedure, router } from '../trpc.js';
import {
  approveManualBillingRequest,
  assertPlatformAdmin,
  createBillingCheckout,
  createManualBillingRequest,
  getBillingAuditTrail,
  listManualBillingRequests,
  listOrganizationEntitlements,
  rejectManualBillingRequest,
} from '../../services/billing.service.js';

const CheckoutSchema = z.object({
  kind: z.enum(['annual', 'pilot']),
  organizationName: z.string().trim().min(2).max(255),
  classrooms: z.number().int().min(1),
});

const ManualRequestSchema = z.object({
  kind: z.enum(['public_campaign', 'custom_quote']),
  organizationName: z.string().trim().min(2).max(255),
  classrooms: z.number().int().min(1),
  note: z.string().trim().max(2000).optional(),
});

const ManualResolutionSchema = z.object({
  requestId: z.string().min(1),
  resolutionNote: z.string().trim().min(1).max(2000),
});

export const billingRouter = router({
  createCheckout: protectedProcedure.input(CheckoutSchema).mutation(async ({ ctx, input }) => {
    return createBillingCheckout({
      userId: ctx.user.sub,
      email: ctx.user.email,
      organizationName: input.organizationName,
      classrooms: input.classrooms,
      kind: input.kind,
    });
  }),

  createManualRequest: protectedProcedure
    .input(ManualRequestSchema)
    .mutation(async ({ ctx, input }) => {
      return createManualBillingRequest({
        userId: ctx.user.sub,
        organizationName: input.organizationName,
        classrooms: input.classrooms,
        kind: input.kind,
        note: input.note,
      });
    }),

  listManualRequests: protectedProcedure.query(async ({ ctx }) => {
    assertPlatformAdmin(ctx.user);
    return listManualBillingRequests();
  }),

  approveManualRequest: protectedProcedure
    .input(ManualResolutionSchema)
    .mutation(async ({ ctx, input }) => {
      assertPlatformAdmin(ctx.user);
      return approveManualBillingRequest({
        requestId: input.requestId,
        reviewedBy: ctx.user.sub,
        resolutionNote: input.resolutionNote,
      });
    }),

  rejectManualRequest: protectedProcedure
    .input(ManualResolutionSchema)
    .mutation(async ({ ctx, input }) => {
      assertPlatformAdmin(ctx.user);
      return rejectManualBillingRequest({
        requestId: input.requestId,
        reviewedBy: ctx.user.sub,
        resolutionNote: input.resolutionNote,
      });
    }),

  listEntitlements: protectedProcedure.query(async ({ ctx }) => {
    assertPlatformAdmin(ctx.user);
    return listOrganizationEntitlements();
  }),

  getAuditTrail: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string().min(1).optional(),
          requestId: z.string().min(1).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      assertPlatformAdmin(ctx.user);
      return getBillingAuditTrail({
        organizationId: input?.organizationId,
        requestId: input?.requestId,
      });
    }),
});
