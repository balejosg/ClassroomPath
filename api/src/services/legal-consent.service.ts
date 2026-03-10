import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

export const CURRENT_TERMS_VERSION = '2026-03-09';

export async function recordTermsAcceptance(params: {
  userId: string;
  termsVersion: string;
  acceptedAt?: Date;
}): Promise<void> {
  const acceptedAt = params.acceptedAt ?? new Date();

  await db
    .insert(schema.cpTermsAcceptance)
    .values({
      userId: params.userId,
      termsVersion: params.termsVersion,
      acceptedAt,
      updatedAt: acceptedAt,
    })
    .onConflictDoUpdate({
      target: schema.cpTermsAcceptance.userId,
      set: {
        termsVersion: params.termsVersion,
        acceptedAt,
        updatedAt: acceptedAt,
      },
    });
}
