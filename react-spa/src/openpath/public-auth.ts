/**
 * Re-export bridge for the OpenPath public-auth surface.
 *
 * This file is the ClassroomPath wrapper's single point of contact for auth
 * helpers from upstream OpenPath. Do NOT edit upstream/openpath/ for wrapper
 * work. To extend or override auth behaviour, add it here or in a ClassroomPath
 * component -- never inside the submodule.
 *
 * Boundary doc: docs/contracts/openpath-public-surface.md
 */
export { isAdmin, setUnauthorizedResponseHandler } from '@openpath/public-auth';
