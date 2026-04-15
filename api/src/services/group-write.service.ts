import { TRPCError } from '@trpc/server';
import { addGroupToTeacherRole } from './group-role-membership.service.js';
export {
  bulkDeleteOrganizationGroupRules,
  deleteOrganizationGroup,
} from './group-delete.service.js';
export {
  createOrganizationGroup,
  createOrganizationGroupFromRules,
  type GroupRuleSeed,
} from './group-create.service.js';
export { updateOrganizationGroup } from './group-update.service.js';
export {
  addGroupToTeacherRole,
  removeGroupFromTeacherRole,
} from './group-role-membership.service.js';
