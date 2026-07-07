import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import {
  deleteClassroomById,
  deleteMachineFromClassroom,
  getMachineClassroomLink,
} from '../../db/openpath-repos/classrooms.repo.js';
import {
  createOperationalExemptionAndNotify,
  createScheduleExemptionAndNotify,
  deleteExemptionAndNotify,
  getExemptionById,
} from '../../db/openpath-repos/machine-exemptions.repo.js';
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

  await deleteMachineFromClassroom(params.input.id, params.input.classroomId);
}

export async function createClassroomExemptionForTenant(params: {
  ctx: ClassroomWriteContext;
  input: CreateClassroomExemptionInput;
}) {
  await assertOrgClassroomAccess(params.ctx.organizationId!, params.input.classroomId);

  const machine = await getMachineClassroomLink(params.input.machineId);
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
  const row = await createScheduleExemptionAndNotify({
    id,
    machineId: params.input.machineId,
    classroomId: params.input.classroomId,
    scheduleId: params.input.scheduleId,
    groupId: params.input.groupId ?? null,
    createdBy: params.ctx.user.sub,
    expiresAt,
  });

  if (!row) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Could not create exemption' });
  }

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

  const machine = await getMachineClassroomLink(params.input.machineId);
  if (!machine || machine.classroomId !== params.input.classroomId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' });
  }

  const expiresAt = new Date(Date.now() + params.input.durationHours * 60 * 60 * 1000);
  const id = `exempt_${nanoid(10)}`;
  const row = await createOperationalExemptionAndNotify({
    id,
    machineId: params.input.machineId,
    classroomId: params.input.classroomId,
    scheduleId: null,
    source: 'operational',
    reason,
    createdBy: params.ctx.user.sub,
    expiresAt,
  });

  if (!row) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Could not create exemption' });
  }

  return presentClassroomExemption(row);
}

export async function deleteClassroomExemptionForTenant(params: {
  ctx: ClassroomWriteContext;
  id: string;
}): Promise<void> {
  const row = await getExemptionById(params.id);
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

  await deleteExemptionAndNotify(params.id, row.classroomId);
}

export async function deleteClassroomRecord(classroomId: string): Promise<void> {
  await deleteClassroomById(classroomId);
}
