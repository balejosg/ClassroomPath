import { z } from 'zod';

export const OpenPathRoleInfoSchema = z
  .object({
    role: z.string().min(1),
    groupIds: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const OpenPathMeResponseSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
        email: z.string().min(1),
        name: z.string().min(1),
        roles: z.array(OpenPathRoleInfoSchema).optional().default([]),
      })
      .passthrough(),
  })
  .passthrough();

export type OpenPathMeResponse = z.infer<typeof OpenPathMeResponseSchema>;
