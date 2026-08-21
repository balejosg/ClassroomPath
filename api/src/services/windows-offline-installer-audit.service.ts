import { recordAuditEvent } from './audit-core.service.js';

export interface WindowsOfflineInstallerAuditInput {
  organizationId: string;
  actorUserId: string;
  classroomId: string;
  templateVersion: string;
  templateCommit: string;
  templateSha256: string;
  artifactSha256: string;
  artifactSize: number;
  tokenExpiresAt: string;
}

/**
 * Records a generation event. Deliberately typed so token material, the
 * payload JSON, download references, and executable bytes cannot be attached.
 */
export async function recordWindowsOfflineInstallerGeneration(
  input: WindowsOfflineInstallerAuditInput
): Promise<string> {
  return recordAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: 'windows_offline_installer.generate',
    targetType: 'classroom',
    targetId: input.classroomId,
    metadata: {
      templateVersion: input.templateVersion,
      templateCommit: input.templateCommit,
      templateSha256: input.templateSha256,
      artifactSha256: input.artifactSha256,
      artifactSize: input.artifactSize,
      tokenExpiresAt: input.tokenExpiresAt,
    },
  });
}
