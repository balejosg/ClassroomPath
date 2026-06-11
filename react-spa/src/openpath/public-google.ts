/**
 * Re-export bridge for the OpenPath public-google surface.
 *
 * This file is the ClassroomPath wrapper's single point of contact for Google
 * credential types from upstream OpenPath. Do NOT edit upstream/openpath/ for
 * wrapper work. To extend or override Google auth handling, add it here or in a
 * ClassroomPath component -- never inside the submodule.
 *
 * Boundary doc: docs/contracts/openpath-public-surface.md
 */
export type { GoogleCredentialResponse } from '@openpath/public-google';
import '@openpath/public-google';
