import { TRPCError } from '@trpc/server';
import type { ZodType } from 'zod';

export function extractTrpcData<T>(data: unknown): T | null {
  if (typeof data !== 'object' || data === null) return null;
  const wrapped = data as { result?: { data?: T } };
  if (wrapped.result?.data !== undefined) return wrapped.result.data;
  return data as T;
}

export function parseOpenPathPayload<T>(
  payload: unknown,
  schema: ZodType<T>,
  invalidMessage: string
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: invalidMessage,
    });
  }

  return parsed.data;
}
