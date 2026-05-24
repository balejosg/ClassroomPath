import { TRPCError } from '@trpc/server';
import { getOrCreateOrganizationMutationOperation } from '../../lib/organization-mutation-workflow/operations.js';
import { getMutationResult } from '../../lib/cross-system-mutations.js';
import { throwConflictOnUniqueViolation } from '../../lib/pg-errors.js';
import { presentTenantClassroom } from './classroom-access.service.js';
import { normalizeCreateClassroomParams } from './classroom-create-params.service.js';
import { runCreateClassroomWorkflow } from './classroom-create-workflow.service.js';
import {
  assertUsableGroupIfProvided,
  type ClassroomWriteContext,
  type CreateClassroomInput,
} from './classroom-write-shared.js';

export async function createClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  input: CreateClassroomInput;
}) {
  const normalized = normalizeCreateClassroomParams(params);

  await assertUsableGroupIfProvided(params.ctx, params.input.defaultGroupId);

  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'classroomCreate',
    organizationId: normalized.organizationId,
    userId: normalized.userId,
    publicName: normalized.publicName,
    displayName: normalized.displayName,
    defaultGroupId: normalized.defaultGroupId,
  });

  const storedResult = getMutationResult<{ classroomId: string }>(operation);

  if (operation.status === 'completed' && storedResult) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Classroom with this name already exists in your organization',
    });
  }

  try {
    const classroom = await runCreateClassroomWorkflow({
      defaultGroupId: normalized.defaultGroupId,
      displayName: normalized.displayName,
      operation,
      organizationId: normalized.organizationId,
      scopedName: normalized.scopedName,
      storedResult: storedResult ?? null,
    });
    if (!classroom) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create classroom' });
    }
    return presentTenantClassroom({ classroom });
  } catch (err) {
    if (!storedResult) {
      throwConflictOnUniqueViolation(
        err,
        'Classroom with this name already exists in your organization'
      );
    }
    throw err;
  }
}
