export type ApiLocale = 'en' | 'es';

export function resolveApiLocale(locale?: string | null): ApiLocale {
  return locale?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export const apiCopy = {
  en: {
    email: {
      greeting: (name: string) => `Hello ${name},`,
      invitationSubject: (organizationName: string) =>
        `Invitation to ${organizationName} on ClassroomPath`,
      invitationIntro: (organizationName: string, role: string) =>
        `${organizationName} invited you to ClassroomPath as ${role}.`,
      invitationAction: (invitationUrl: string) => `Activate your access here: ${invitationUrl}`,
      invitationActionLabel: 'Activate your access',
      linkExpires: (expiresAtIso: string) => `This link expires on ${expiresAtIso}.`,
      resetSubject: 'Reset your ClassroomPath access',
      resetIntro: 'Your administrator generated a link to reset your ClassroomPath access.',
      resetAction: (resetUrl: string) => `Use it here: ${resetUrl}`,
      resetActionLabel: 'Reset access',
      verificationSubject: 'Verify your ClassroomPath email',
      verificationIntro: 'Your ClassroomPath account has been created.',
      verificationAction: (verificationUrl: string) => `Verify your email here: ${verificationUrl}`,
      verificationActionLabel: 'Verify email',
    },
    errors: {
      invitationDeliveryFailed:
        'The invitation email could not be sent. Try again from this screen.',
      resetDeliveryFailed:
        'The recovery email could not be sent. Generate a new email to try again.',
      activeInvitationExists: 'An active invitation already exists for this email',
      noOrganizationsAvailable: 'No organizations are available',
      organizationSelectionRequired: 'Select an organization to request access',
      inactiveGroupClone: 'Inactive groups cannot be cloned',
      invitationLoginRequired: 'Sign in with the invited account to accept this invitation.',
      invitationEmailMismatch: 'You must sign in with the invited email to accept this invitation.',
      invitationPasswordRequired: 'Create a password to activate this invitation.',
      noPendingInvitation: 'You do not have any pending invitations.',
      logoutRevocationFailed:
        'The OpenPath session could not be revoked. The local session was closed.',
      currentTermsRequired: 'You must accept the current terms version',
    },
    push: {
      newDomainRequestTitle: 'New domain request',
      newDomainRequestBody: (domain: string) => `${domain} is requesting access`,
      approveAction: 'Approve',
    },
  },
  es: {
    email: {
      greeting: (name: string) => `Hola ${name},`,
      invitationSubject: (organizationName: string) =>
        `Invitación a ${organizationName} en ClassroomPath`,
      invitationIntro: (organizationName: string, role: string) =>
        `${organizationName} te invitó a ClassroomPath como ${role}.`,
      invitationAction: (invitationUrl: string) => `Activa tu acceso aquí: ${invitationUrl}`,
      invitationActionLabel: 'Activa tu acceso',
      linkExpires: (expiresAtIso: string) => `Este enlace vence el ${expiresAtIso}.`,
      resetSubject: 'Restablece tu acceso a ClassroomPath',
      resetIntro: 'Tu administrador generó un enlace para restablecer tu acceso a ClassroomPath.',
      resetAction: (resetUrl: string) => `Úsalo aquí: ${resetUrl}`,
      resetActionLabel: 'Restablecer acceso',
      verificationSubject: 'Verifica tu correo de ClassroomPath',
      verificationIntro: 'Tu cuenta de ClassroomPath ya está creada.',
      verificationAction: (verificationUrl: string) =>
        `Verifica tu correo aquí: ${verificationUrl}`,
      verificationActionLabel: 'Verificar correo',
    },
    errors: {
      invitationDeliveryFailed: 'No se pudo enviar la invitación. Reintenta desde esta pantalla.',
      resetDeliveryFailed:
        'No se pudo enviar el correo de recuperación. Genera un nuevo correo para reintentar.',
      activeInvitationExists: 'Ya existe una invitación activa para este correo',
      noOrganizationsAvailable: 'No hay organizaciones disponibles',
      organizationSelectionRequired: 'Debes seleccionar una organización para solicitar acceso',
      inactiveGroupClone: 'No se puede clonar un grupo inactivo',
      invitationLoginRequired: 'Inicia sesión con la cuenta invitada para aceptar esta invitación.',
      invitationEmailMismatch:
        'Debes iniciar sesión con el correo invitado para aceptar esta invitación.',
      invitationPasswordRequired: 'Debes crear una contraseña para activar esta invitación.',
      noPendingInvitation: 'No tienes ninguna invitación pendiente.',
      logoutRevocationFailed: 'No se pudo revocar la sesión en OpenPath. La sesión local se cerró.',
      currentTermsRequired: 'Debes aceptar la versión vigente de los términos',
    },
    push: {
      newDomainRequestTitle: 'Nueva solicitud de dominio',
      newDomainRequestBody: (domain: string) => `${domain} solicita acceso`,
      approveAction: 'Aprobar',
    },
  },
} as const;

export function getApiCopy(locale?: string | null) {
  return apiCopy[resolveApiLocale(locale)];
}
