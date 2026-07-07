import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { classrooms, openpathDb } from '../../db/openpath.js';
import { notifyOpenPathClassroomChanged } from '../../db/openpath-repos/publish.js';
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
  const hasClassroomUpdates = Object.keys(updateData).length > 0;
  let [updated] = hasClassroomUpdates
    ? await openpathDb.update(classrooms).set(updateData).where(eq(classrooms.id, id)).returning()
    : await openpathDb.select().from(classrooms).where(eq(classrooms.id, id)).limit(1);

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  const updatedCaptivePortalDomains =
    normalizedCaptivePortalDomains !== undefined
      ? await updateCaptivePortalDomainsIfSupported(updated.id, normalizedCaptivePortalDomains)
      : false;

  if (updatedCaptivePortalDomains) {
    const [refreshed] = await openpathDb
      .select()
      .from(classrooms)
      .where(eq(classrooms.id, updated.id))
      .limit(1);
    updated = refreshed ?? updated;
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
): Promise<boolean> {
  try {
    await openpathDb
      .update(classrooms)
      .set({ captivePortalDomains })
      .where(eq(classrooms.id, classroomId));
    return true;
  } catch (err) {
    if (isMissingCaptivePortalDomainsColumnError(err)) {
      return false;
    }
    throw err;
  }
}

function isMissingCaptivePortalDomainsColumnError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string } };
  return error.code === '42703' || error.cause?.code === '42703';
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
