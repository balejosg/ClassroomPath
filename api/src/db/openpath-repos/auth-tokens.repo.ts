import { eq } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../openpath.js';

// Owning module for the two auth token tables (password reset + email
// verification). Both flows are replace-semantics: at most one live token per
// user, enforced by delete-then-insert exactly as the call sites did. No
// notify pairing (F5).

export async function replacePasswordResetToken(
  userId: string,
  values: { id: string; tokenHash: string; expiresAt: Date }
): Promise<void> {
  await openpathDb
    .delete(openpathSchema.passwordResetTokens)
    .where(eq(openpathSchema.passwordResetTokens.userId, userId));

  await openpathDb.insert(openpathSchema.passwordResetTokens).values({
    id: values.id,
    userId,
    tokenHash: values.tokenHash,
    expiresAt: values.expiresAt,
  });
}

export async function deletePasswordResetTokensByUserId(userId: string): Promise<void> {
  await openpathDb
    .delete(openpathSchema.passwordResetTokens)
    .where(eq(openpathSchema.passwordResetTokens.userId, userId));
}

export async function replaceEmailVerificationToken(
  userId: string,
  values: { id: string; tokenHash: string; expiresAt: Date }
): Promise<void> {
  await openpathDb
    .delete(openpathSchema.emailVerificationTokens)
    .where(eq(openpathSchema.emailVerificationTokens.userId, userId));

  await openpathDb.insert(openpathSchema.emailVerificationTokens).values({
    id: values.id,
    userId,
    tokenHash: values.tokenHash,
    expiresAt: values.expiresAt,
  });
}
