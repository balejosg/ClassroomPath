export type AuthResultWithUser = { user: unknown };

export function isAuthResultWithUser(value: unknown): value is AuthResultWithUser {
  return typeof value === 'object' && value !== null && 'user' in value;
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}
