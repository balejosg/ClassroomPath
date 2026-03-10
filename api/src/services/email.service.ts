import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  sent: boolean;
  provider: 'mock' | 'resend' | 'disabled';
  id?: string;
}

function resendConfigured(): boolean {
  return !!config.resendApiKey && !!config.resendFromEmail;
}

export async function sendTransactionalEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (config.mockEmailDelivery) {
    logger.info('Email delivery mocked for test environment', {
      to: params.to,
      subject: params.subject,
    });
    return { sent: true, provider: 'mock', id: 'mock-email' };
  }

  if (!resendConfigured()) {
    logger.warn('Resend delivery disabled because credentials are not configured', {
      to: params.to,
      subject: params.subject,
    });
    return { sent: false, provider: 'disabled' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resendFromEmail,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('Failed to send email with Resend', {
      to: params.to,
      subject: params.subject,
      status: response.status,
      body: body.slice(0, 500),
    });
    throw new Error('Email delivery failed');
  }

  const payload = (await response.json().catch(() => ({}))) as { id?: unknown };
  return {
    sent: true,
    provider: 'resend',
    id: typeof payload.id === 'string' ? payload.id : undefined,
  };
}
