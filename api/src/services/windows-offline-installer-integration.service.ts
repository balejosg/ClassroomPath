import type { OpenPathForwardRequest } from '../lib/openpath/headers.js';
import {
  openPathGateway,
  type OpenPathGateway,
  type OpenPathWindowsOfflineInstallerMetadata,
} from '../lib/openpath/gateway.js';
import { assertOrgClassroomAccess } from '../lib/tenant-access.js';

export type WindowsOfflineInstallerIntegrationGateway = Pick<
  OpenPathGateway,
  'generateWindowsOfflineInstaller'
>;

export interface WindowsOfflineInstallerIntegrationInput {
  organizationId: string;
  classroomId: string;
  token: string | null;
  req?: OpenPathForwardRequest;
}

export interface WindowsOfflineInstallerIntegrationDependencies {
  gateway?: WindowsOfflineInstallerIntegrationGateway;
  assertClassroomAccess?: typeof assertOrgClassroomAccess;
}

/**
 * Applies only ClassroomPath's tenant policy, then delegates the complete
 * installer lifecycle to the documented OpenPath public gateway.
 */
export async function generateClassroomPathWindowsOfflineInstaller(
  input: WindowsOfflineInstallerIntegrationInput,
  dependencies: WindowsOfflineInstallerIntegrationDependencies = {}
): Promise<OpenPathWindowsOfflineInstallerMetadata> {
  const assertClassroomAccess = dependencies.assertClassroomAccess ?? assertOrgClassroomAccess;
  const gateway = dependencies.gateway ?? openPathGateway;

  await assertClassroomAccess(input.organizationId, input.classroomId);

  return gateway.generateWindowsOfflineInstaller({
    req: input.req,
    token: input.token,
    input: { classroomId: input.classroomId },
  });
}
