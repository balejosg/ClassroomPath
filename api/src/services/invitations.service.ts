import { TRPCError } from '@trpc/server';
import { and, eq, gt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

import { config } from '../config.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { openpathDb, openpathSchema } from '../db/openpath.js';
import { generateId } from '../lib/id.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import {
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
  throwMembershipConflict,
} from '../lib/tenant-memberships.js';
import { sendTransactionalEmail } from './email.service.js';

const INVITATION_TTL_HOURS = 72;

function createInvitationToken(): string {
  return randomBytes(24).toString('base64url');
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildInvitationUrl(token: string): string {
  return `${config.publicUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

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
}

async function assertEmailCanBeInvited(email: string): Promise<void> {
  const existingUser = await openpathDb
    .select({ id: openpathSchema.users.id })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.email, email))
    .limit(1);

  if (existingUser.length > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        'El correo ya pertenece a una cuenta existente. Usa aprobación pendiente o recuperación de acceso.',
    });
  }
}

async function getOrganizationOrThrow(organizationId: string) {
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

export async function listOrganizationInvitations(
  organizationId: string
): Promise<OrganizationInvitationSummary[]> {
  const rows = await db
    .select({
      id: schema.cpInvitations.id,
      organizationId: schema.cpInvitations.organizationId,
      email: schema.cpInvitations.email,
      name: schema.cpInvitations.name,
      role: schema.cpInvitations.role,
      createdAt: schema.cpInvitations.createdAt,
      expiresAt: schema.cpInvitations.expiresAt,
    })
    .from(schema.cpInvitations)
    .where(
      and(
        eq(schema.cpInvitations.organizationId, organizationId),
        gt(schema.cpInvitations.expiresAt, new Date())
      )
    );

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'teacher',
    createdAt: toIsoStringOrNull(row.createdAt),
    expiresAt: row.expiresAt.toISOString(),
    status: 'Pending',
  }));
}

export async function createOrganizationInvitation(params: {
  organizationId: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher';
  invitedBy: string;
}): Promise<
  OrganizationInvitationSummary & {
    invitationUrl: string;
    emailSent: boolean;
  }
> {
  const organization = await getOrganizationOrThrow(params.organizationId);
  const normalizedEmail = params.email.trim().toLowerCase();
  const trimmedName = params.name.trim();
  const invitationId = generateId('inv');

  await assertEmailCanBeInvited(normalizedEmail);

  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const invitationUrl = buildInvitationUrl(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

  try {
    await db.insert(schema.cpInvitations).values({
      id: invitationId,
      organizationId: params.organizationId,
      email: normalizedEmail,
      name: trimmedName,
      role: params.role,
      tokenHash,
      invitedBy: params.invitedBy,
      expiresAt,
    });
  } catch (error) {
    throwConflictOnUniqueViolation(error, 'Ya existe una invitación activa para este correo');
    throw error;
  }

  try {
    const delivery = await sendTransactionalEmail({
      to: normalizedEmail,
      subject: `Invitación a ${organization.name} en ClassroomPath`,
      text: [
        `Hola ${trimmedName},`,
        '',
        `${organization.name} te invitó a ClassroomPath como ${params.role}.`,
        `Activa tu acceso aquí: ${invitationUrl}`,
        '',
        `Este enlace vence el ${expiresAt.toISOString()}.`,
      ].join('\n'),
      html: [
        `<p>Hola ${trimmedName},</p>`,
        `<p><strong>${organization.name}</strong> te invitó a ClassroomPath como <strong>${params.role}</strong>.</p>`,
        `<p><a href="${invitationUrl}">Activa tu acceso</a></p>`,
        `<p>Este enlace vence el <strong>${expiresAt.toISOString()}</strong>.</p>`,
      ].join(''),
    });

    return {
      id: invitationId,
      organizationId: params.organizationId,
      email: normalizedEmail,
      name: trimmedName,
      role: params.role,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'Pending',
      invitationUrl,
      emailSent: delivery.sent,
    };
  } catch (error) {
    await db
      .delete(schema.cpInvitations)
      .where(
        and(
          eq(schema.cpInvitations.organizationId, params.organizationId),
          eq(schema.cpInvitations.email, normalizedEmail)
        )
      );

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'No se pudo enviar la invitación',
    });
  }
}

export async function revokeOrganizationInvitation(params: {
  organizationId: string;
  invitationId: string;
}): Promise<{ success: true }> {
  const deleted = await db
    .delete(schema.cpInvitations)
    .where(
      and(
        eq(schema.cpInvitations.organizationId, params.organizationId),
        eq(schema.cpInvitations.id, params.invitationId)
      )
    )
    .returning({ id: schema.cpInvitations.id });

  if (deleted.length === 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Invitation not found',
    });
  }

  return { success: true };
}

export async function getInvitationByToken(
  token: string
): Promise<OrganizationInvitationDetails | null> {
  const tokenHash = hashInvitationToken(token);
  const [invitation] = await db
    .select({
      id: schema.cpInvitations.id,
      organizationId: schema.cpInvitations.organizationId,
      organizationName: schema.cpOrganizations.name,
      email: schema.cpInvitations.email,
      name: schema.cpInvitations.name,
      role: schema.cpInvitations.role,
      invitedBy: schema.cpInvitations.invitedBy,
      createdAt: schema.cpInvitations.createdAt,
      expiresAt: schema.cpInvitations.expiresAt,
    })
    .from(schema.cpInvitations)
    .innerJoin(
      schema.cpOrganizations,
      eq(schema.cpOrganizations.id, schema.cpInvitations.organizationId)
    )
    .where(eq(schema.cpInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    return null;
  }

  if (invitation.expiresAt <= new Date()) {
    await db.delete(schema.cpInvitations).where(eq(schema.cpInvitations.id, invitation.id));
    return null;
  }

  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName: invitation.organizationName,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role === 'admin' ? 'admin' : 'teacher',
    invitedBy: invitation.invitedBy,
    createdAt: toIsoStringOrNull(invitation.createdAt),
    expiresAt: invitation.expiresAt.toISOString(),
    status: 'Pending',
  };
}

export async function acceptOrganizationInvitation(params: {
  invitationId: string;
  organizationId: string;
  userId: string;
  invitedBy: string;
  role: 'admin' | 'teacher';
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const existingMemberships = await tx
        .select({ organizationId: schema.cpMemberships.organizationId })
        .from(schema.cpMemberships)
        .where(eq(schema.cpMemberships.userId, params.userId))
        .limit(2);

      if (existingMemberships.length > 0) {
        throwMembershipConflict(existingMemberships.length);
      }

      await tx.insert(schema.cpMemberships).values({
        id: generateId('mem'),
        userId: params.userId,
        organizationId: params.organizationId,
        role: params.role,
        invitedBy: params.invitedBy,
      });

      await tx
        .delete(schema.cpInvitations)
        .where(
          and(
            eq(schema.cpInvitations.id, params.invitationId),
            eq(schema.cpInvitations.organizationId, params.organizationId)
          )
        );
    });
  } catch (error) {
    throwConflictOnUniqueViolation(error, SINGLE_ORG_MEMBERSHIP_MESSAGE);
    throw error;
  }
}
