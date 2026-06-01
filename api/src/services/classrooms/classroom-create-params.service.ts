import { scopedClassroomNameForOrg } from './classroom-name.service.js';
import {
  assertClassroomWriteInputName,
  normalizeCaptivePortalDomains,
  type ClassroomWriteContext,
  type CreateClassroomInput,
} from './classroom-write-shared.js';

export function normalizeCreateClassroomParams(params: {
  ctx: ClassroomWriteContext;
  input: CreateClassroomInput;
}) {
  const publicName = assertClassroomWriteInputName(params.input.name);
  const displayName = params.input.displayName?.trim() || publicName;
  const captivePortalDomains = normalizeCaptivePortalDomains(params.input.captivePortalDomains);

  return {
    captivePortalDomains,
    defaultGroupId: params.input.defaultGroupId,
    displayName,
    organizationId: params.ctx.organizationId!,
    publicName,
    scopedName: scopedClassroomNameForOrg(params.ctx.organizationId!, publicName),
    userId: params.ctx.user.sub,
  };
}
