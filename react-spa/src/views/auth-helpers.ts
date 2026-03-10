import { persistSession } from '../lib/auth-storage';

export type AuthResultWithUser = { user: unknown };
export type VerificationDeliveryState = {
  email: string;
  emailSent: boolean;
  verificationUrl: string;
};

type PasswordSetupValidationOptions = {
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
  passwordErrorMessage: string;
  passwordMismatchMessage: string;
  termsRequiredMessage: string;
  passwordPolicy?: (password: string) => boolean;
};

const LOCAL_DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export function isAuthResultWithUser(value: unknown): value is AuthResultWithUser {
  return typeof value === 'object' && value !== null && 'user' in value;
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function persistAuthSession(result: unknown): void {
  persistSession({ user: isAuthResultWithUser(result) ? result.user : undefined });
}

export function normalizeVerificationDeliveryState(
  value: unknown,
  fallbackEmail = ''
): VerificationDeliveryState {
  const candidate =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

  return {
    email: typeof candidate?.email === 'string' ? candidate.email : fallbackEmail,
    emailSent: candidate?.emailSent === true,
    verificationUrl:
      typeof candidate?.verificationUrl === 'string' ? candidate.verificationUrl : '',
  };
}

export function shouldShowManualVerificationLink(
  delivery: Pick<VerificationDeliveryState, 'emailSent' | 'verificationUrl'>,
  hostname = typeof window !== 'undefined' ? window.location.hostname : ''
): boolean {
  return (
    delivery.verificationUrl.length > 0 &&
    (!delivery.emailSent || LOCAL_DEV_HOSTNAMES.has(hostname))
  );
}

export function getVerificationDeliveryMessage(
  delivery: Pick<VerificationDeliveryState, 'email' | 'emailSent'>
): string {
  return delivery.emailSent
    ? `Enviamos un enlace de verificacion a ${delivery.email}.`
    : `No pudimos confirmar la entrega del correo a ${delivery.email}. Usa el enlace manual de abajo.`;
}

export function getPasswordSetupError(options: PasswordSetupValidationOptions): string | null {
  const passwordIsValid = options.passwordPolicy
    ? options.passwordPolicy(options.password)
    : options.password.length >= 8;

  if (!passwordIsValid) {
    return options.passwordErrorMessage;
  }

  if (options.password !== options.confirmPassword) {
    return options.passwordMismatchMessage;
  }

  if (!options.termsAccepted) {
    return options.termsRequiredMessage;
  }

  return null;
}
