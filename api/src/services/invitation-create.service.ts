import { TRPCError } from '@trpc/server';
import {
  deleteAuditEventByIdBestEffort,
  recordInvitationCreatedAuditEvent,
} from './audit.service.js';
import { sendTransactionalEmail } from './email.service.js';
import {
  INVITATION_DELIVERY_FAILED_MESSAGE,
  type OrganizationInvitationSummary,
} from './invitation-shared.service.js';
import { buildOrganizationInvitationEmail } from './invitation-delivery-content.service.js';
import {
  createPendingOrganizationInvitationRecord,
  deletePendingOrganizationInvitationRecord,
} from './invitation-persist.service.js';

export async function createOrganizationInvitation(params: {
  organizationId: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher';
  invitedBy: string;
}): Promise<
  OrganizationInvitationSummary & {
    emailSent: boolean;
  }
> {
  const { expiresAt, invitationId, invitationUrl, normalizedEmail, organization, trimmedName } =
    await createPendingOrganizationInvitationRecord(params);

  const invitationAuditEventId = await recordInvitationCreatedAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.invitedBy,
    invitationId,
    email: normalizedEmail,
    name: trimmedName,
    role: params.role,
  });

  try {
    const email = buildOrganizationInvitationEmail({
      expiresAtIso: expiresAt.toISOString(),
      invitationUrl,
      organizationName: organization.name,
      recipientName: trimmedName,
      role: params.role,
    });
    const delivery = await sendTransactionalEmail({
      to: normalizedEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (!delivery.sent) {
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: INVITATION_DELIVERY_FAILED_MESSAGE,
      });
    }

    return {
      id: invitationId,
      organizationId: params.organizationId,
      email: normalizedEmail,
      name: trimmedName,
      role: params.role,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'Pending',
      emailSent: true,
    };
  } catch (error) {
    await deletePendingOrganizationInvitationRecord({
      organizationId: params.organizationId,
      invitationId,
    });
    await deleteAuditEventByIdBestEffort({
      auditEventId: invitationAuditEventId,
      action: 'invitation.created',
      targetId: invitationId,
    });

    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: INVITATION_DELIVERY_FAILED_MESSAGE,
    });
  }
}
