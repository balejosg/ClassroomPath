import {
  EmailDeliveryProviderError,
  type SendEmailParams,
  type SendEmailResult,
  sendTransactionalEmail,
} from './email.service.js';

type EmailDeliveryPreflightCode =
  | 'success'
  | 'delivery_failed'
  | 'provider_application_not_found'
  | 'provider_daily_quota_exceeded'
  | 'provider_mismatch'
  | 'provider_unauthorized'
  | 'provider_unavailable';

type SendEmail = (params: SendEmailParams) => Promise<SendEmailResult>;
type EmailPreflightPolicyEnv = Record<string, string | undefined>;

interface EmailDeliveryPreflightOptions {
  now?: () => number;
  recipient?: string;
  requireProvider?: SendEmailResult['provider'] | false;
  sendEmail?: SendEmail;
  maxAttempts?: number;
  retryDelayMs?: number;
}

interface EmailDeliveryPreflightBaseResult {
  code: EmailDeliveryPreflightCode;
  id?: string;
  message?: string;
  provider?: SendEmailResult['provider'] | 'resend';
  status?: number;
}

export type EmailDeliveryPreflightResult =
  | (EmailDeliveryPreflightBaseResult & { code: 'success'; ok: true })
  | (EmailDeliveryPreflightBaseResult & { ok: false });

function defaultRecipient(now: () => number): string {
  return `delivered+cpdiag${now()}@resend.dev`;
}

function classifyProviderError(error: EmailDeliveryProviderError): EmailDeliveryPreflightResult {
  const body = error.body;

  if (error.status === 401 || error.status === 403) {
    return {
      ok: false,
      code: 'provider_unauthorized',
      provider: 'resend',
      status: error.status,
      message: body,
    };
  }

  if (error.status === 404 && /Application not found/i.test(body)) {
    return {
      ok: false,
      code: 'provider_application_not_found',
      provider: 'resend',
      status: error.status,
      message: 'Application not found',
    };
  }

  if (
    error.status === 429 &&
    (/daily_quota_exceeded/i.test(body) || /daily email sending quota/i.test(body))
  ) {
    return {
      ok: false,
      code: 'provider_daily_quota_exceeded',
      provider: 'resend',
      status: error.status,
      message: body || error.message,
    };
  }

  return {
    ok: false,
    code: 'provider_unavailable',
    provider: 'resend',
    status: error.status,
    message: body || error.message,
  };
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  return value === '1' || /^true$/i.test(value ?? '') || /^yes$/i.test(value ?? '');
}

export function shouldAcceptEmailPreflightFailure(
  result: EmailDeliveryPreflightResult,
  env: EmailPreflightPolicyEnv = process.env as EmailPreflightPolicyEnv
): boolean {
  return (
    result.ok === false &&
    result.code === 'provider_daily_quota_exceeded' &&
    isTruthyEnvFlag(env['CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA'])
  );
}

function isTransientProviderError(error: EmailDeliveryProviderError): boolean {
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export async function checkTransactionalEmailDelivery(
  options: EmailDeliveryPreflightOptions = {}
): Promise<EmailDeliveryPreflightResult> {
  const now = options.now ?? Date.now;
  const requireProvider = options.requireProvider ?? 'resend';
  const sendEmail = options.sendEmail ?? sendTransactionalEmail;
  const to = options.recipient ?? defaultRecipient(now);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 2000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await sendEmail({
        to,
        subject: 'ClassroomPath email delivery preflight',
        html: '<p>ClassroomPath email delivery preflight</p>',
        text: 'ClassroomPath email delivery preflight',
      });

      if (!result.sent || (requireProvider && result.provider !== requireProvider)) {
        return {
          ok: false,
          code: 'provider_mismatch',
          provider: result.provider,
        };
      }

      return {
        ok: true,
        code: 'success',
        provider: result.provider,
        id: result.id,
      };
    } catch (error) {
      if (error instanceof EmailDeliveryProviderError) {
        const classifiedError = classifyProviderError(error);
        const shouldRetry = isTransientProviderError(error) && attempt < maxAttempts;

        if (!shouldRetry) {
          return classifiedError;
        }

        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
        continue;
      }

      return {
        ok: false,
        code: 'delivery_failed',
        message: error instanceof Error ? error.message : 'Unknown email delivery failure',
      };
    }
  }

  return {
    ok: false,
    code: 'delivery_failed',
    message: 'Unknown email delivery failure',
  };
}
