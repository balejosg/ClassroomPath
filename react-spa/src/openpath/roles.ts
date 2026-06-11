/**
 * Re-export bridge for OpenPath shared role utilities.
 *
 * This file is the ClassroomPath wrapper's single point of contact for role
 * helpers from upstream OpenPath (via @openpath/shared). Do NOT edit
 * upstream/openpath/ for wrapper work. To extend role logic, add wrapper code
 * here or in a ClassroomPath component -- never inside the submodule.
 *
 * Boundary doc: docs/contracts/openpath-public-surface.md
 */
export { normalizeUserRoleString } from '@openpath/shared/roles';
