import { TRPCError } from '@trpc/server';

import {
  OpenPathEmailVerificationPayloadSchema,
  OpenPathRegistrationPayloadSchema,
  OpenPathSessionPayloadSchema,
  type OpenPathEmailVerificationPayload,
  type OpenPathRegistrationPayload,
  type OpenPathSessionPayload,
} from '../../lib/openpath-auth-schema.js';
import { CURRENT_TERMS_VERSION } from '../../services/legal-consent.service.js';

function invalidUpstreamPayload(message: string): never {
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
  });
}

export function parseOpenPathSessionPayload(payload: unknown): OpenPathSessionPayload {
  const parsed = OpenPathSessionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    invalidUpstreamPayload('Invalid session payload received from upstream');
  }

  return parsed.data;
}

export function parseOpenPathRegistrationPayload(payload: unknown): OpenPathRegistrationPayload {
  const parsed = OpenPathRegistrationPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    invalidUpstreamPayload('Invalid registration payload received from upstream');
  }

  return parsed.data;
}

export function parseOpenPathEmailVerificationPayload(
  payload: unknown
): OpenPathEmailVerificationPayload {
  const parsed = OpenPathEmailVerificationPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    invalidUpstreamPayload('Invalid email verification payload received from upstream');
  }

  return parsed.data;
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeDisplayName(name: string): string {
  return name.trim();
}

export function assertCurrentTermsVersion(termsVersion: string): void {
  if (termsVersion !== CURRENT_TERMS_VERSION) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Debes aceptar la version vigente de los terminos',
    });
  }
}
