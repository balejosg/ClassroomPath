import { TRPCError } from '@trpc/server';

import { whitelistGroups } from '../db/openpath.js';
import { throwConflictOnUniqueViolation } from '../lib/pg-errors.js';
import { getOrCreateOrganizationMutationOperation } from '../lib/cross-system-mutation-definitions.js';
import { getMutationResult } from '../lib/cross-system-mutations.js';
import {
  normalizeOrganizationGroupFromRulesParams,
  type CreateOrganizationGroupFromRulesParams,
} from './group-create-from-rules-params.service.js';
import { runCreateOrganizationGroupFromRulesWorkflow } from './group-create-from-rules-workflow.service.js';
import type { GroupRuleSeed } from './group-seeded-upstream-create.service.js';

export async function createOrganizationGroupFromRules(
  params: CreateOrganizationGroupFromRulesParams
): Promise<{
  group: typeof whitelistGroups.$inferSelect;
  publicName: string;
  visibility: string;
}> {
  const normalized = normalizeOrganizationGroupFromRulesParams(params);
  const operation = await getOrCreateOrganizationMutationOperation({
    kind: 'groupCreate',
    organizationId: normalized.organizationId,
    actorUserId: normalized.actorUserId,
    actorRole: normalized.actorRole,
    displayName: normalized.displayName,
    enabled: normalized.enabled,
    publicName: normalized.publicName,
    rules: normalized.rules,
    visibility: normalized.visibility,
  });

  const storedResult = getMutationResult<{
    groupId: string;
    publicName: string;
    visibility: string;
  }>(operation);

  if (operation.status === 'completed' && storedResult) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Ya existe un grupo con ese identificador (slug)',
    });
  }

  try {
    const group = await runCreateOrganizationGroupFromRulesWorkflow({
      actorRole: normalized.actorRole,
      actorUserId: normalized.actorUserId,
      displayName: normalized.displayName,
      enabled: normalized.enabled,
      name: normalized.name,
      operation,
      organizationId: normalized.organizationId,
      publicName: normalized.publicName,
      rules: normalized.rules,
      storedResult: storedResult ?? null,
      visibility: normalized.visibility,
    });
    if (!group) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create group' });
    }
    return {
      group,
      publicName: normalized.publicName,
      visibility: normalized.visibility,
    };
  } catch (err) {
    throwConflictOnUniqueViolation(err, 'Ya existe un grupo con ese identificador (slug)');
    throw err;
  }
}

export type { GroupRuleSeed } from './group-seeded-upstream-create.service.js';
