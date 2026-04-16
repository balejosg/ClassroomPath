import { z } from 'zod';

import { router, publicProcedure, tenantMemberProcedure } from '../trpc.js';
import {
  deleteTenantPushSubscription,
  getTenantPushStatus,
  getTenantVapidPublicKey,
  saveTenantPushSubscription,
} from '../../services/push.service.js';

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushRouter = router({
  getVapidPublicKey: publicProcedure.query(() => getTenantVapidPublicKey()),

  getStatus: tenantMemberProcedure.query(async ({ ctx }) => {
    return getTenantPushStatus(ctx);
  }),

  subscribe: tenantMemberProcedure
    .input(
      z.object({
        subscription: pushSubscriptionSchema,
        groupIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return saveTenantPushSubscription({
        ctx,
        subscription: {
          endpoint: input.subscription.endpoint,
          expirationTime: input.subscription.expirationTime ?? null,
          keys: input.subscription.keys,
        },
        groupIds: input.groupIds,
      });
    }),

  unsubscribe: tenantMemberProcedure
    .input(
      z.object({
        endpoint: z.string().url().optional(),
        subscriptionId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return deleteTenantPushSubscription({
        ctx,
        endpoint: input.endpoint,
        subscriptionId: input.subscriptionId,
      });
    }),
});
