import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  openpathDb,
  notifyOpenPathClassroomChanged,
  classrooms,
  machines,
  machineExemptions,
} from '../../db/openpath.js';
import { resolveActiveScheduleExpiresAt } from '../schedules/current-group.service.js';
import { scopedClassroomNameForOrg } from './classroom-name.service.js';
import { presentTenantClassroom } from './classroom-access.service.js';
import {
  assertCanUseGroup,
  assertOrgClassroomAccess,
  assertOrgGroupAccess,
  getOrgClassroomLinkOrThrow,
} from '../../lib/tenant-access.js';
import { throwConflictOnUniqueViolation } from '../../lib/pg-errors.js';

export type ClassroomWriteContext = Parameters<typeof assertCanUseGroup>[0];

export interface CreateClassroomInput {
  name: string;
  displayName?: string;
  defaultGroupId?: string;
}

export interface UpdateClassroomInput {
  id: string;
  displayName?: string;
  defaultGroupId?: string;
}

export interface CreateClassroomExemptionInput {
  machineId: string;
  classroomId: string;
  scheduleId: string;
}

export interface DeleteClassroomMachineInput {
  id: string;
  classroomId: string;
}

async function assertUsableGroupIfProvided(
  ctx: ClassroomWriteContext,
  groupId: string | null | undefined
): Promise<void> {
  if (!groupId) return;

  await assertOrgGroupAccess(ctx.organizationId!, groupId);
  await assertCanUseGroup(ctx, groupId);
}

function presentExemption(row: typeof machineExemptions.$inferSelect) {
  return {
    id: row.id,
    machineId: row.machineId,
    classroomId: row.classroomId,
    scheduleId: row.scheduleId,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function createClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  input: CreateClassroomInput;
}) {
  const publicName = params.input.name.trim();
  const displayName = params.input.displayName?.trim() || publicName;

  if (!publicName) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom name is required' });
  }

  await assertUsableGroupIfProvided(params.ctx, params.input.defaultGroupId);

  const classroomId = nanoid();
  const scopedName = scopedClassroomNameForOrg(params.ctx.organizationId!, publicName);

  let classroom: typeof classrooms.$inferSelect | undefined;
  try {
    [classroom] = await openpathDb
      .insert(classrooms)
      .values({
        id: classroomId,
        name: scopedName,
        displayName,
        defaultGroupId: params.input.defaultGroupId,
      })
      .returning();
  } catch (err: unknown) {
    throwConflictOnUniqueViolation(
      err,
      'Classroom with this name already exists in your organization'
    );
    throw err;
  }

  if (!classroom) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create classroom' });
  }

  await db.insert(schema.cpOrganizationClassrooms).values({
    id: nanoid(),
    organizationId: params.ctx.organizationId!,
    classroomId: classroom.id,
  });

  return presentTenantClassroom({ classroom });
}

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

export async function deleteClassroomMachineForTenant(params: {
  ctx: ClassroomWriteContext;
  input: DeleteClassroomMachineInput;
}): Promise<void> {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.classroomId);

  await openpathDb
    .delete(machines)
    .where(
      and(eq(machines.id, params.input.id), eq(machines.classroomId, params.input.classroomId))
    );
}

export async function createClassroomExemptionForTenant(params: {
  ctx: ClassroomWriteContext;
  input: CreateClassroomExemptionInput;
}) {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.classroomId);

  const machineRow = await openpathDb
    .select({ id: machines.id, classroomId: machines.classroomId })
    .from(machines)
    .where(eq(machines.id, params.input.machineId))
    .limit(1);

  const machine = machineRow[0];
  if (!machine || machine.classroomId !== params.input.classroomId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' });
  }

  const expiresAt = await resolveActiveScheduleExpiresAt({
    classroomId: params.input.classroomId,
    scheduleId: params.input.scheduleId,
    now: new Date(),
  });

  const id = `exempt_${nanoid(10)}`;
  const inserted = await openpathDb
    .insert(machineExemptions)
    .values({
      id,
      machineId: params.input.machineId,
      classroomId: params.input.classroomId,
      scheduleId: params.input.scheduleId,
      createdBy: params.ctx.user.sub,
      expiresAt,
    })
    .onConflictDoNothing({
      target: [
        machineExemptions.machineId,
        machineExemptions.scheduleId,
        machineExemptions.expiresAt,
      ],
    })
    .returning();

  const row =
    inserted[0] ??
    (
      await openpathDb
        .select()
        .from(machineExemptions)
        .where(
          and(
            eq(machineExemptions.machineId, params.input.machineId),
            eq(machineExemptions.scheduleId, params.input.scheduleId),
            eq(machineExemptions.expiresAt, expiresAt)
          )
        )
        .limit(1)
    )[0];

  if (!row) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Could not create exemption' });
  }

  await notifyOpenPathClassroomChanged(params.input.classroomId);
  return presentExemption(row);
}

export async function deleteClassroomExemptionForTenant(params: {
  ctx: ClassroomWriteContext;
  id: string;
}): Promise<void> {
  const existing = await openpathDb
    .select({ id: machineExemptions.id, classroomId: machineExemptions.classroomId })
    .from(machineExemptions)
    .where(eq(machineExemptions.id, params.id))
    .limit(1);

  const row = existing[0];
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Exemption not found' });
  }

  await assertOrgClassroomAccess(params.ctx.organizationId!, row.classroomId);

  await openpathDb.delete(machineExemptions).where(eq(machineExemptions.id, params.id));
  await notifyOpenPathClassroomChanged(row.classroomId);
}

export async function deleteClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  classroomId: string;
}): Promise<void> {
  const orgClassroom = await getOrgClassroomLinkOrThrow(
    params.ctx.organizationId!,
    params.classroomId
  );

  await db
    .delete(schema.cpOrganizationClassrooms)
    .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom.id));

  await openpathDb.delete(classrooms).where(eq(classrooms.id, params.classroomId));
}
