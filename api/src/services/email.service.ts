import { config } from '../config.js';
import { appendTestEmailSinkEntry } from '../lib/test-email-sink.js';
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

export class EmailDeliveryProviderError extends Error {
  readonly body: string;
  readonly status: number;

  constructor(message: string, options: { body: string; status: number }) {
    super(message);
    this.name = 'EmailDeliveryProviderError';
    this.body = options.body;
    this.status = options.status;
  }
}

export async function sendTransactionalEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (config.emailDeliveryMode === 'mock') {
    await appendTestEmailSinkEntry({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      createdAt: new Date().toISOString(),
    });
    logger.info('Email delivery mocked for test environment', {
      to: params.to,
      subject: params.subject,
    });
    return { sent: true, provider: 'mock', id: 'mock-email' };
  }

  if (config.emailDeliveryMode !== 'resend') {
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
    throw new EmailDeliveryProviderError('Email delivery failed', {
      status: response.status,
      body: body.slice(0, 500),
    });
  }

  const payload = (await response.json().catch(() => ({}))) as { id?: unknown };
  return {
    sent: true,
    provider: 'resend',
    id: typeof payload.id === 'string' ? payload.id : undefined,
  };
}
