import { TRPCError } from '@trpc/server';

import { toOpenPathEnabledFlag } from '../lib/tenant-access.js';
import { normalizeGroupKey, scopedGroupNameForOrg } from './group-name.service.js';
import type { GroupRuleSeed } from './group-seeded-upstream-create.service.js';

export type CreateOrganizationGroupFromRulesParams = {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  publicName: string;
  displayName: string;
  enabled?: number | boolean;
  visibility?: string;
  rules: GroupRuleSeed[];
};

export type NormalizedOrganizationGroupFromRulesParams = CreateOrganizationGroupFromRulesParams & {
  enabled: 0 | 1;
  name: string;
  publicName: string;
  visibility: string;
};

export function normalizeOrganizationGroupFromRulesParams(
  params: CreateOrganizationGroupFromRulesParams
): NormalizedOrganizationGroupFromRulesParams {
  const publicName = normalizeGroupKey(params.publicName);
  if (!publicName) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Group name is required' });
  }

  return {
    ...params,
    enabled: toOpenPathEnabledFlag(params.enabled ?? 1),
    name: scopedGroupNameForOrg(params.organizationId, publicName),
    publicName,
    visibility: params.visibility ?? 'private',
  };
}
