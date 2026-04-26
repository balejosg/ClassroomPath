import { eq } from 'drizzle-orm';

import { openpathDb, publishWhitelistGroupChanged, whitelistGroups } from '../db/openpath.js';
import { runUpstreamFirstProvisioningWorkflow } from '../lib/cross-system-workflow-engine.js';
import type {
  getMutationResult,
  getOrCreateMutationOperation,
} from '../lib/cross-system-mutations.js';
import { linkOrganizationGroup } from './group-local-link.service.js';
import {
  createSeededUpstreamGroup,
  type GroupRuleSeed,
} from './group-seeded-upstream-create.service.js';

type MutationOperation = Awaited<ReturnType<typeof getOrCreateMutationOperation>>;

type StoredGroupCreateResult = NonNullable<
  ReturnType<
    typeof getMutationResult<{
      groupId: string;
      publicName: string;
      visibility: string;
    }>
  >
>;

export async function runCreateOrganizationGroupFromRulesWorkflow(params: {
  actorRole?: string;
  actorUserId: string;
  displayName: string;
  enabled: 0 | 1;
  name: string;
  operation: MutationOperation;
  organizationId: string;
  publicName: string;
  rules: GroupRuleSeed[];
  storedResult: StoredGroupCreateResult | null;
  visibility: string;
}): Promise<typeof whitelistGroups.$inferSelect | undefined> {
  let group = params.storedResult
    ? (
        await openpathDb
          .select()
          .from(whitelistGroups)
          .where(eq(whitelistGroups.id, params.storedResult.groupId))
          .limit(1)
      )[0]
    : undefined;

  const workflow = await runUpstreamFirstProvisioningWorkflow({
    operation: params.operation,
    initialResult: params.storedResult,
    initialState: {
      group,
    },
    metadata: params.operation.metadata as Record<string, unknown>,
    createUpstream: async () => {
      const createdGroup = await createSeededUpstreamGroup({
        name: params.name,
        displayName: params.displayName,
        enabled: params.enabled,
        rules: params.rules,
      });

      return {
        organizationId: params.organizationId,
        result: {
          groupId: createdGroup.id,
          publicName: params.publicName,
          visibility: params.visibility,
        },
        state: (current: { group?: typeof whitelistGroups.$inferSelect }) => ({
          ...current,
          group: createdGroup,
        }),
      };
    },
    linkLocal: async ({ result, state }) => {
      if (!result || !state.group) {
        return;
      }

      await linkOrganizationGroup({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        groupId: state.group.id,
        publicName: params.publicName,
        visibility: params.visibility,
      });

      return {
        organizationId: params.organizationId,
        result,
      };
    },
    complete: async ({ result, state }) => {
      if (!result || !state.group) {
        return;
      }

      await publishWhitelistGroupChanged(state.group.id);

      return {
        organizationId: params.organizationId,
        result,
      };
    },
  });

  group = workflow.state.group;
  return group;
}
