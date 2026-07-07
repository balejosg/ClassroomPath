// Thin facade kept for its established import path and public names; the
// transactional seeded create moved to the owning repository
// (api/src/db/openpath-repos/groups.repo.ts). Callers are workflow steps that
// publish via their own ledger `complete` step -- see groups.repo docs.

export type { GroupRuleSeed } from '../db/openpath-repos/groups.repo.js';
export { createGroupWithRules as createSeededUpstreamGroup } from '../db/openpath-repos/groups.repo.js';
