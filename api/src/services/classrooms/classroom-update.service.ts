import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { classrooms, notifyOpenPathClassroomChanged, openpathDb } from '../../db/openpath.js';
import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';
import { presentTenantClassroom } from './classroom-access.service.js';
import {
  assertUsableGroupIfProvided,
  type ClassroomWriteContext,
  type UpdateClassroomInput,
} from './classroom-write-shared.js';

export async function updateClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  input: UpdateClassroomInput;
}) {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.id);
  await assertUsableGroupIfProvided(params.ctx, params.input.defaultGroupId);

  const { id, ...updateData } = params.input;
  const [updated] = await openpathDb
    .update(classrooms)
    .set(updateData)
    .where(eq(classrooms.id, id))
    .returning();

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  if (params.input.defaultGroupId !== undefined) {
    await notifyOpenPathClassroomChanged(updated.id);
  }

  return presentTenantClassroom({ classroom: updated });
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
