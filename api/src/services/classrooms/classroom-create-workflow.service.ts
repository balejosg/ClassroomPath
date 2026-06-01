import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '../../db/index.js';
import { classrooms, openpathDb } from '../../db/openpath.js';
import * as schema from '../../db/schema.js';
import { runUpstreamFirstProvisioningWorkflow } from '../../lib/cross-system-workflow-engine.js';
import type {
  getMutationResult,
  getOrCreateMutationOperation,
} from '../../lib/cross-system-mutations.js';

type MutationOperation = Awaited<ReturnType<typeof getOrCreateMutationOperation>>;
type StoredClassroomCreateResult = NonNullable<
  ReturnType<
    typeof getMutationResult<{
      classroomId: string;
    }>
  >
>;

export async function runCreateClassroomWorkflow(params: {
  captivePortalDomains: string[];
  defaultGroupId?: string | null;
  displayName: string;
  operation: MutationOperation;
  organizationId: string;
  scopedName: string;
  storedResult: StoredClassroomCreateResult | null;
}) {
  let classroom = params.storedResult
    ? (
        await openpathDb
          .select()
          .from(classrooms)
          .where(eq(classrooms.id, params.storedResult.classroomId))
          .limit(1)
      )[0]
    : undefined;

  const workflow = await runUpstreamFirstProvisioningWorkflow({
    operation: params.operation,
    initialResult: params.storedResult,
    initialState: { classroom },
    metadata: params.operation.metadata as Record<string, unknown>,
    createUpstream: async () => {
      const classroomId = nanoid();
      const [createdClassroom] = await openpathDb
        .insert(classrooms)
        .values({
          id: classroomId,
          name: params.scopedName,
          displayName: params.displayName,
          defaultGroupId: params.defaultGroupId,
        })
        .returning();

      await updateCreatedClassroomCaptivePortalDomainsIfSupported(
        classroomId,
        params.captivePortalDomains
      );

      return {
        organizationId: params.organizationId,
        result: { classroomId },
        state: { classroom: createdClassroom },
      };
    },
    linkLocal: async ({ result, state }) => {
      if (!result || !state.classroom) {
        return;
      }

      const existingLink = await db
        .select({ id: schema.cpOrganizationClassrooms.id })
        .from(schema.cpOrganizationClassrooms)
        .where(
          and(
            eq(schema.cpOrganizationClassrooms.organizationId, params.organizationId),
            eq(schema.cpOrganizationClassrooms.classroomId, state.classroom.id)
          )
        )
        .limit(1);

      if (existingLink.length === 0) {
        await db.insert(schema.cpOrganizationClassrooms).values({
          id: nanoid(),
          organizationId: params.organizationId,
          classroomId: state.classroom.id,
        });
      }

      return {
        organizationId: params.organizationId,
        result,
      };
    },
    complete: async ({ result }) => {
      if (!result) {
        return;
      }

      return {
        organizationId: params.organizationId,
        result,
      };
    },
  });

  classroom = workflow.state.classroom;
  return classroom;
}

async function updateCreatedClassroomCaptivePortalDomainsIfSupported(
  classroomId: string,
  captivePortalDomains: string[]
): Promise<void> {
  if (captivePortalDomains.length === 0) {
    return;
  }

  try {
    await openpathDb.execute(sql`
      UPDATE classrooms
      SET captive_portal_domains = ${captivePortalDomains}::text[]
      WHERE id = ${classroomId}
    `);
  } catch (err) {
    if (isMissingCaptivePortalDomainsColumnError(err)) {
      return;
    }
    throw err;
  }
}

function isMissingCaptivePortalDomainsColumnError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    error.code === '42703' ||
    error.cause?.code === '42703' ||
    error.message?.includes('captive_portal_domains') === true
  );
}
