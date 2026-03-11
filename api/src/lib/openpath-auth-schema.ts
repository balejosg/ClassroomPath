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
        emailVerified: z.boolean().optional(),
        roles: z.array(OpenPathRoleInfoSchema).optional().default([]),
      })
      .passthrough(),
  })
  .passthrough();

export const OpenPathAuthUserSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().min(1),
    name: z.string().min(1),
    roles: z.unknown().optional(),
  })
  .passthrough();

export const OpenPathSessionPayloadSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    user: OpenPathAuthUserSchema,
  })
  .passthrough();

export const OpenPathRegistrationPayloadSchema = z
  .object({
    user: OpenPathAuthUserSchema,
    verificationRequired: z.literal(true),
    verificationToken: z.string().min(1).optional(),
    verificationExpiresAt: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const hasToken = value.verificationToken !== undefined;
    const hasExpiry = value.verificationExpiresAt !== undefined;

    if (hasToken === hasExpiry) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'verificationToken and verificationExpiresAt must be provided together',
      path: hasToken ? ['verificationExpiresAt'] : ['verificationToken'],
    });
  });

export const OpenPathEmailVerificationPayloadSchema = z
  .object({
    email: z.string().min(1),
    verificationRequired: z.literal(true),
    verificationToken: z.string().min(1),
    verificationExpiresAt: z.string().min(1),
  })
  .passthrough();

export type OpenPathMeResponse = z.infer<typeof OpenPathMeResponseSchema>;
export type OpenPathSessionPayload = z.infer<typeof OpenPathSessionPayloadSchema>;
export type OpenPathRegistrationPayload = z.infer<typeof OpenPathRegistrationPayloadSchema>;
export type OpenPathEmailVerificationPayload = z.infer<
  typeof OpenPathEmailVerificationPayloadSchema
>;
