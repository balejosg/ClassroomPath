import { TRPCError } from '@trpc/server';

const UNIQUE_VIOLATION_CODE = '23505';

function getErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return null;
  }

  return String((err as { code?: unknown }).code);
}

function getErrorMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('message' in err)) {
    return '';
  }

  return String((err as { message?: unknown }).message);
}

export function isPgUniqueViolation(err: unknown): boolean {
  const code = getErrorCode(err);
  if (code === UNIQUE_VIOLATION_CODE) return true;

  const normalizedMessage = getErrorMessage(err).toLowerCase();
  return normalizedMessage.includes('unique constraint');
}

export function throwConflictOnUniqueViolation(err: unknown, message: string): never {
  if (isPgUniqueViolation(err)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message,
    });
  }

  throw err;
}
