import { TRPCError } from '@trpc/server';

import {
  getClassroomById,
  setActiveGroupAndNotify,
  updateCaptivePortalDomainsIfSupported,
  updateClassroomFields,
} from '../../db/openpath-repos/classrooms.repo.js';
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
  let updated = hasClassroomUpdates
    ? await updateClassroomFields(id, updateData)
    : await getClassroomById(id);

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  const updatedCaptivePortalDomains =
    normalizedCaptivePortalDomains !== undefined
      ? await updateCaptivePortalDomainsIfSupported(updated.id, normalizedCaptivePortalDomains)
      : false;

  if (updatedCaptivePortalDomains) {
    updated = (await getClassroomById(updated.id)) ?? updated;
  }

  if (
    params.input.defaultGroupId !== undefined ||
    params.input.captivePortalDomains !== undefined
  ) {
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

  const updated = await setActiveGroupAndNotify(params.classroomId, params.groupId);

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
  }

  return presentTenantClassroom({ classroom: updated });
}
