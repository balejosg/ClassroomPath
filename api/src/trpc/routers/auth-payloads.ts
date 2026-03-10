import { TRPCError } from '@trpc/server';

import { CURRENT_TERMS_VERSION } from '../../services/legal-consent.service.js';

export type OpenPathSessionPayload = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles?: unknown;
  };
};

export type OpenPathRegistrationPayload = {
  user: {
    id: string;
    email: string;
    name: string;
    roles?: unknown;
  };
  verificationRequired: true;
  verificationToken: string;
  verificationExpiresAt: string;
};

export type OpenPathEmailVerificationPayload = {
  email: string;
  verificationRequired: true;
  verificationToken: string;
  verificationExpiresAt: string;
};

function invalidUpstreamPayload(message: string): never {
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
  });
}

export function parseOpenPathSessionPayload(payload: unknown): OpenPathSessionPayload {
  if (!payload || typeof payload !== 'object') {
    invalidUpstreamPayload('Invalid session payload received from upstream');
  }

  const candidate = payload as Record<string, unknown>;
  const user = candidate.user;

  if (
    typeof candidate.accessToken !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    !user ||
    typeof user !== 'object'
  ) {
    invalidUpstreamPayload('Invalid session payload received from upstream');
  }

  const userRecord = user as Record<string, unknown>;
  if (
    typeof userRecord.id !== 'string' ||
    typeof userRecord.email !== 'string' ||
    typeof userRecord.name !== 'string'
  ) {
    invalidUpstreamPayload('Invalid session payload received from upstream');
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    user: {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      roles: userRecord.roles,
    },
  };
}

export function parseOpenPathRegistrationPayload(payload: unknown): OpenPathRegistrationPayload {
  if (!payload || typeof payload !== 'object') {
    invalidUpstreamPayload('Invalid registration payload received from upstream');
  }

  const candidate = payload as Record<string, unknown>;
  const user = candidate.user;

  if (
    candidate.verificationRequired !== true ||
    typeof candidate.verificationToken !== 'string' ||
    typeof candidate.verificationExpiresAt !== 'string' ||
    !user ||
    typeof user !== 'object'
  ) {
    invalidUpstreamPayload('Invalid registration payload received from upstream');
  }

  const userRecord = user as Record<string, unknown>;
  if (
    typeof userRecord.id !== 'string' ||
    typeof userRecord.email !== 'string' ||
    typeof userRecord.name !== 'string'
  ) {
    invalidUpstreamPayload('Invalid registration payload received from upstream');
  }

  return {
    verificationRequired: true,
    verificationToken: candidate.verificationToken,
    verificationExpiresAt: candidate.verificationExpiresAt,
    user: {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      roles: userRecord.roles,
    },
  };
}

export function parseOpenPathEmailVerificationPayload(
  payload: unknown
): OpenPathEmailVerificationPayload {
  if (!payload || typeof payload !== 'object') {
    invalidUpstreamPayload('Invalid email verification payload received from upstream');
  }

  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.email !== 'string' ||
    candidate.verificationRequired !== true ||
    typeof candidate.verificationToken !== 'string' ||
    typeof candidate.verificationExpiresAt !== 'string'
  ) {
    invalidUpstreamPayload('Invalid email verification payload received from upstream');
  }

  return {
    email: candidate.email,
    verificationRequired: true,
    verificationToken: candidate.verificationToken,
    verificationExpiresAt: candidate.verificationExpiresAt,
  };
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
