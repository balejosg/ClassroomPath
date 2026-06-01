import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';

import { classrooms, notifyOpenPathClassroomChanged, openpathDb } from '../../db/openpath.js';
import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';
import { presentTenantClassroom } from './classroom-access.service.js';
import {
  assertUsableGroupIfProvided,
  normalizeCaptivePortalDomains,
  type ClassroomWriteContext,
  type UpdateClassroomInput,
} from './classroom-write-shared.js';

export async function updateClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  input: UpdateClassroomInput;
}) {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.id);
  await assertUsableGroupIfProvided(params.ctx, params.input.defaultGroupId);

  const { id, captivePortalDomains, ...updateData } = params.input;
  const normalizedCaptivePortalDomains =
    captivePortalDomains !== undefined
      ? normalizeCaptivePortalDomains(captivePortalDomains)
      : undefined;
  const [updated] = await openpathDb
    .update(classrooms)
    .set(updateData)
    .where(eq(classrooms.id, id))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  if (normalizedCaptivePortalDomains !== undefined) {
    await updateCaptivePortalDomainsIfSupported(updated.id, normalizedCaptivePortalDomains);
  }

  if (
    params.input.defaultGroupId !== undefined ||
    params.input.captivePortalDomains !== undefined
  ) {
    await notifyOpenPathClassroomChanged(updated.id);
  }

  return presentTenantClassroom({ classroom: updated });
}

async function updateCaptivePortalDomainsIfSupported(
  classroomId: string,
  captivePortalDomains: string[]
): Promise<void> {
  try {
    await openpathDb.execute(sql`
      UPDATE classrooms
      SET captive_portal_domains = ${captivePortalDomains}::text[]
      WHERE id = ${classroomId}
    `);
  } catch (err) {
    if (isMissingCaptivePortalDomainsColumnError(err)) {
      return;
    }
    throw err;
  }
}

function isMissingCaptivePortalDomainsColumnError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    error.code === '42703' ||
    error.cause?.code === '42703' ||
    error.message?.includes('captive_portal_domains') === true
  );
}

export async function setActiveGroupForTenant(params: {
  ctx: ClassroomWriteContext;
  classroomId: string;
  groupId: string | null;
}) {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.classroomId);
  await assertUsableGroupIfProvided(params.ctx, params.groupId);

  const [updated] = await openpathDb
    .update(classrooms)
    .set({ activeGroupId: params.groupId })
    .where(eq(classrooms.id, params.classroomId))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  await notifyOpenPathClassroomChanged(updated.id);
  return presentTenantClassroom({ classroom: updated });
}
