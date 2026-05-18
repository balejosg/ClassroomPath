import { createHash, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { config } from '../config.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';
import { apiCopy } from '../lib/api-content.js';

export const INVITATION_TTL_HOURS = 72;
export const INVITATION_DELIVERY_FAILED_MESSAGE = apiCopy.en.errors.invitationDeliveryFailed;

export interface OrganizationInvitationSummary {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher';
  createdAt: string | null;
  expiresAt: string;
  status: 'Pending';
}

export interface OrganizationInvitationDetails extends OrganizationInvitationSummary {
  organizationName: string;
  invitedBy: string;
  hasExistingAccount: boolean;
  currentOrganizationName: string | null;
}

export function createInvitationToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function buildInvitationUrl(token: string): string {
  return `${config.publicUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
}

export function buildInvitationExpiresAt(nowMs = Date.now()): Date {
  return new Date(nowMs + INVITATION_TTL_HOURS * 60 * 60 * 1000);
}

export function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toInvitationSummary(row: {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  createdAt: Date | null;
  expiresAt: Date;
}): OrganizationInvitationSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'teacher',
    createdAt: toIsoStringOrNull(row.createdAt),
    expiresAt: row.expiresAt.toISOString(),
    status: 'Pending',
  };
}

export async function findExistingOpenPathUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  name: string;
} | null> {
  const [existingUser] = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.email, email))
    .limit(1);

  return existingUser ?? null;
}

export async function getOrganizationOrThrow(organizationId: string) {
  const [organization] = await db
    .select({
      id: schema.cpOrganizations.id,
      name: schema.cpOrganizations.name,
    })
    .from(schema.cpOrganizations)
    .where(eq(schema.cpOrganizations.id, organizationId))
    .limit(1);

  if (!organization) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Organization not found',
    });
  }

  return organization;
}
