import { importTemplateIntoOrganization, publishTemplateFromGroup } from './group-copy.service.js';

export async function publishTemplateFromOrganizationGroup(params: {
  actorUserId: string;
  organizationId: string;
  groupId: string;
  name?: string;
  displayName?: string;
  description?: string;
}) {
  return publishTemplateFromGroup(params);
}

export async function importTemplateToOrganization(params: {
  organizationId: string;
  actorUserId: string;
  actorRole?: string;
  templateId: string;
  name?: string;
  displayName?: string;
}) {
  return importTemplateIntoOrganization(params);
}
