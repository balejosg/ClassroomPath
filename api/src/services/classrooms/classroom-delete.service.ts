import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { getOrCreateOrganizationMutationOperation } from '../../lib/organization-mutation-workflow/operations.js';
import { getMutationResult } from '../../lib/cross-system-mutations.js';
import { getOrgClassroomLinkOrThrow } from '../../lib/tenant-access.js';
import { runDeleteMutationWorkflow } from '../../lib/cross-system-workflow-engine.js';
import { deleteClassroomRecord } from './classroom-exemptions.service.js';
import { type ClassroomWriteContext } from './classroom-write-shared.js';

export async function deleteClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  classroomId: string;
}): Promise<void> {
  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'classroomDelete',
    organizationId: params.ctx.organizationId!,
    userId: params.ctx.user.sub,
    classroomId: params.classroomId,
  });

  if (operation.status === 'completed') {
    return;
  }

  await runDeleteMutationWorkflow({
    operation,
    initialResult: getMutationResult<{ success: true; classroomId: string }>(operation),
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    commitLocalDelete: async () => {
      const orgClassroom = await getOrgClassroomLinkOrThrow(
        params.ctx.organizationId!,
        params.classroomId
      );

      await db
        .delete(schema.cpOrganizationClassrooms)
        .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom.id));

      return {
        result: { success: true as const, classroomId: params.classroomId },
      };
    },
    completeDelete: async ({ result }) => {
      await deleteClassroomRecord(params.classroomId);

      return {
        result: result ?? { success: true as const, classroomId: params.classroomId },
      };
    },
  });
}
