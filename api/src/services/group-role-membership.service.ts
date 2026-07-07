// Thin facade kept for its established import path (group-write,
// group-local-link, group-delete-direct); the teacher-role mutations moved to
// the owning repository. Tenant scoping remains the callers' responsibility,
// as the tenant-service-guard exemption for this file documents.

export {
  addGroupToTeacherRole,
  removeGroupFromTeacherRole,
} from '../db/openpath-repos/roles.repo.js';
