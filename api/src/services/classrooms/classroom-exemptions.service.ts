import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  classrooms,
  machineExemptions,
  machines,
  notifyOpenPathClassroomChanged,
  openpathDb,
} from '../../db/openpath.js';
import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';
import { resolveActiveScheduleExpiresAt } from '../schedules/current-group.service.js';
import {
  ClassroomWriteContext,
  CreateClassroomExemptionInput,
  DeleteClassroomMachineInput,
  presentClassroomExemption,
} from './classroom-write-shared.js';

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
  return presentClassroomExemption(row);
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

export async function deleteClassroomRecord(classroomId: string): Promise<void> {
  await openpathDb.delete(classrooms).where(eq(classrooms.id, classroomId));
}
