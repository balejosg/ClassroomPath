import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import {
  getOrCreateMutationOperation,
  getMutationResult,
} from '../../lib/cross-system-mutations.js';
import { getOrgClassroomLinkOrThrow } from '../../lib/tenant-access.js';
import { runMutationWorkflow } from '../../lib/cross-system-workflow-engine.js';
import { deleteClassroomRecord } from './classroom-exemptions.service.js';
import { type ClassroomWriteContext } from './classroom-write-shared.js';

export async function deleteClassroomForTenant(params: {
  ctx: ClassroomWriteContext;
  classroomId: string;
}): Promise<void> {
  const operation = await getOrCreateMutationOperation({
    operationType: 'classrooms.delete_classroom',
    idempotencyKey: `${params.ctx.organizationId}:${params.classroomId}`,
    organizationId: params.ctx.organizationId!,
    userId: params.ctx.user.sub,
    metadata: { classroomId: params.classroomId },
  });

  if (operation.status === 'completed') {
    return;
  }

  await runMutationWorkflow({
    operation,
    initialResult: getMutationResult<{ success: true; classroomId: string }>(operation),
    initialState: {},
    metadata: operation.metadata as Record<string, unknown>,
    steps: [
      {
        step: 'local_committed',
        shouldRun: ({ result }) => !result,
        run: async () => {
          const orgClassroom = await getOrgClassroomLinkOrThrow(
            params.ctx.organizationId!,
            params.classroomId
          );

          await db
            .delete(schema.cpOrganizationClassrooms)
            .where(eq(schema.cpOrganizationClassrooms.id, orgClassroom.id));

          return {
            result: { success: true, classroomId: params.classroomId },
          };
        },
      },
      {
        step: 'completed',
        completed: true,
        shouldRun: ({ result }) => Boolean(result),
        run: async ({ result }) => {
          await deleteClassroomRecord(params.classroomId);

          return {
            result: result ?? { success: true, classroomId: params.classroomId },
          };
        },
      },
    ],
  });
}
