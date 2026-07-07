import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { classrooms, machineExemptions, machines, openpathDb } from '../../db/openpath.js';
import { notifyOpenPathClassroomChanged } from '../../db/openpath-repos/publish.js';
import { assertOrgClassroomAccess } from '../../lib/tenant-access.js';
import { resolveActiveScheduleExpiresAt } from '../schedules/current-group.service.js';
import {
  assertUsableGroupIfProvided,
  ClassroomWriteContext,
  CreateClassroomExemptionInput,
  CreateOperationalClassroomExemptionInput,
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

  await assertUsableGroupIfProvided(params.ctx, params.input.groupId);

  const id = `exempt_${nanoid(10)}`;
  const inserted = await openpathDb
    .insert(machineExemptions)
    .values({
      id,
      machineId: params.input.machineId,
      classroomId: params.input.classroomId,
      scheduleId: params.input.scheduleId,
      groupId: params.input.groupId ?? null,
      createdBy: params.ctx.user.sub,
      expiresAt,
    })
    .onConflictDoNothing({
      target: [
        machineExemptions.machineId,
        machineExemptions.scheduleId,
        machineExemptions.expiresAt,
      ],
      where: sql`${machineExemptions.source} = 'schedule'`,
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

export async function createOperationalClassroomExemptionForTenant(params: {
  ctx: ClassroomWriteContext;
  input: CreateOperationalClassroomExemptionInput;
}) {
  if (params.ctx.userRole !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }

  if (
    !Number.isInteger(params.input.durationHours) ||
    params.input.durationHours < 1 ||
    params.input.durationHours > 24
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Duration must be between 1 and 24 hours',
    });
  }

  const reason = params.input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Reason must be between 3 and 500 characters',
    });
  }

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

  const expiresAt = new Date(Date.now() + params.input.durationHours * 60 * 60 * 1000);
  const id = `exempt_${nanoid(10)}`;
  const inserted = await openpathDb
    .insert(machineExemptions)
    .values({
      id,
      machineId: params.input.machineId,
      classroomId: params.input.classroomId,
      scheduleId: null,
      source: 'operational',
      reason,
      createdBy: params.ctx.user.sub,
      expiresAt,
    })
    .returning();

  const row = inserted[0];
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
    .select({
      id: machineExemptions.id,
      classroomId: machineExemptions.classroomId,
      source: machineExemptions.source,
    })
    .from(machineExemptions)
    .where(eq(machineExemptions.id, params.id))
    .limit(1);

  const row = existing[0];
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Exemption not found' });
  }

  await assertOrgClassroomAccess(params.ctx.organizationId!, row.classroomId);
  if (row.source === 'operational' && params.ctx.userRole !== 'admin') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only administrators can revoke operational exemptions',
    });
  }

  await openpathDb.delete(machineExemptions).where(eq(machineExemptions.id, params.id));
  await notifyOpenPathClassroomChanged(row.classroomId);
}

export async function deleteClassroomRecord(classroomId: string): Promise<void> {
  await openpathDb.delete(classrooms).where(eq(classrooms.id, classroomId));
}
