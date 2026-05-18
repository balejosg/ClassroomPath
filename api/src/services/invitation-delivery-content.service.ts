import { getApiCopy } from '../lib/api-content.js';

type OrganizationInvitationEmailParams = {
  expiresAtIso: string;
  invitationUrl: string;
  locale?: string | null;
  organizationName: string;
  recipientName: string;
  role: 'admin' | 'teacher';
};

export function buildOrganizationInvitationEmail(params: OrganizationInvitationEmailParams): {
  html: string;
  subject: string;
  text: string;
} {
  const copy = getApiCopy(params.locale).email;

  return {
    subject: copy.invitationSubject(params.organizationName),
    text: [
      copy.greeting(params.recipientName),
      '',
      copy.invitationIntro(params.organizationName, params.role),
      copy.invitationAction(params.invitationUrl),
      '',
      copy.linkExpires(params.expiresAtIso),
    ].join('\n'),
    html: [
      `<p>${copy.greeting(params.recipientName)}</p>`,
      `<p>${copy.invitationIntro(params.organizationName, `<strong>${params.role}</strong>`)}</p>`,
      `<p><a href="${params.invitationUrl}">${copy.invitationActionLabel}</a></p>`,
      `<p>${copy.linkExpires(`<strong>${params.expiresAtIso}</strong>`)}</p>`,
    ].join(''),
  };
}
