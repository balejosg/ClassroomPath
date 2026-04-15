type OrganizationInvitationEmailParams = {
  expiresAtIso: string;
  invitationUrl: string;
  organizationName: string;
  recipientName: string;
  role: 'admin' | 'teacher';
};

export function buildOrganizationInvitationEmail(params: OrganizationInvitationEmailParams): {
  html: string;
  subject: string;
  text: string;
} {
  return {
    subject: `Invitación a ${params.organizationName} en ClassroomPath`,
    text: [
      `Hola ${params.recipientName},`,
      '',
      `${params.organizationName} te invitó a ClassroomPath como ${params.role}.`,
      `Activa tu acceso aquí: ${params.invitationUrl}`,
      '',
      `Este enlace vence el ${params.expiresAtIso}.`,
    ].join('\n'),
    html: [
      `<p>Hola ${params.recipientName},</p>`,
      `<p><strong>${params.organizationName}</strong> te invitó a ClassroomPath como <strong>${params.role}</strong>.</p>`,
      `<p><a href="${params.invitationUrl}">Activa tu acceso</a></p>`,
      `<p>Este enlace vence el <strong>${params.expiresAtIso}</strong>.</p>`,
    ].join(''),
  };
}
