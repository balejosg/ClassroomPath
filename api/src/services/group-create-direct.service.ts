import { presentTenantGroupMutation } from './presenters.js';
import { createOrganizationGroupFromRules } from './group-create-from-rules.service.js';

export async function createOrganizationGroup(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  name: string;
  displayName: string;
  enabled?: number | boolean;
}) {
  const created = await createOrganizationGroupFromRules({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    publicName: params.name,
    displayName: params.displayName,
    enabled: params.enabled,
    rules: [],
  });

  return presentTenantGroupMutation({
    group: created.group,
    publicName: created.publicName,
  });
}
