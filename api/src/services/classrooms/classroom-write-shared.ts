import { TRPCError } from '@trpc/server';

import { machineExemptions } from '../../db/openpath.js';
import { assertCanUseGroup, assertOrgGroupAccess } from '../../lib/tenant-access.js';

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

export async function assertUsableGroupIfProvided(
  ctx: ClassroomWriteContext,
  groupId: string | null | undefined
): Promise<void> {
  if (!groupId) return;

  await assertOrgGroupAccess(ctx.organizationId!, groupId);
  await assertCanUseGroup(ctx, groupId);
}

export function presentClassroomExemption(row: typeof machineExemptions.$inferSelect) {
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

export function assertClassroomWriteInputName(name: string): string {
  const publicName = name.trim();
  if (!publicName) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom name is required' });
  }

  return publicName;
}
