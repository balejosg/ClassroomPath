import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { sendTransactionalEmail } from '../../services/email.service.js';

export interface EmailVerificationDeliveryResult {
  email: string;
  verificationRequired: true;
  emailSent: boolean;
  verificationUrl: string;
  verificationExpiresAt: string;
}

function buildEmailVerificationUrl(params: { email: string; token: string }): string {
  return `${config.publicUrl}/login?email=${encodeURIComponent(params.email)}&token=${encodeURIComponent(params.token)}`;
}

export async function deliverEmailVerification(params: {
  email: string;
  name: string;
  verificationToken: string;
  verificationExpiresAt: string;
}): Promise<EmailVerificationDeliveryResult> {
  const verificationUrl = buildEmailVerificationUrl({
    email: params.email,
    token: params.verificationToken,
  });

  let emailSent = false;
  try {
    const delivery = await sendTransactionalEmail({
      to: params.email,
      subject: 'Verifica tu correo de ClassroomPath',
      text: [
        `Hola ${params.name},`,
        '',
        'Tu cuenta de ClassroomPath ya esta creada.',
        `Verifica tu correo aqui: ${verificationUrl}`,
        '',
        `Este enlace vence el ${params.verificationExpiresAt}.`,
      ].join('\n'),
      html: [
        `<p>Hola ${params.name},</p>`,
        '<p>Tu cuenta de ClassroomPath ya esta creada.</p>',
        `<p><a href="${verificationUrl}">Verificar correo</a></p>`,
        `<p>Este enlace vence el <strong>${params.verificationExpiresAt}</strong>.</p>`,
      ].join(''),
    });

    emailSent = delivery.sent;
  } catch (error) {
    logger.warn('Email verification delivery failed', {
      email: params.email,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    email: params.email,
    verificationRequired: true,
    emailSent,
    verificationUrl,
    verificationExpiresAt: params.verificationExpiresAt,
  };
}
