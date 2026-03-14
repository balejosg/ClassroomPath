import { z } from 'zod';

import { logger } from '../../lib/logger.js';
import { getRequestId } from '../../lib/request-id.js';
import { publicProcedure, router } from '../trpc.js';

const ClientTelemetryErrorSchema = z.object({
  name: z.string().max(200).optional(),
  message: z.string().min(1).max(2_000),
  stack: z.string().max(20_000).optional(),
  code: z.string().max(200).optional(),
});

const ClientTelemetryEventSchema = z.object({
  app: z.literal('classroompath-spa'),
  message: z.string().min(1).max(500),
  route: z.string().max(2_000).nullable(),
  action: z.string().max(200).optional(),
  userRole: z.string().max(100).optional(),
  meta: z.record(z.string(), z.unknown()),
  error: ClientTelemetryErrorSchema,
  timestamp: z.string().datetime({ offset: true }),
});

export const clientTelemetryRouter = router({
  report: publicProcedure.input(ClientTelemetryEventSchema).mutation(async ({ ctx, input }) => {
    logger.warn('Frontend telemetry event', {
      requestId: getRequestId(ctx.req, ctx.res),
      userId: ctx.user?.sub ?? null,
      ...input,
    });

    return { success: true };
  }),
});
