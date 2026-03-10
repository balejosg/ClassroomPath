import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import {
  CURRENT_TERMS_VERSION,
  recordTermsAcceptance,
} from '../src/services/legal-consent.service.js';
import { resetDb } from './test-utils.js';

describe('legal-consent.service', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('records the accepted terms version for a user', async () => {
    const acceptedAt = new Date('2026-03-09T12:00:00.000Z');

    await recordTermsAcceptance({
      userId: 'user-legal-consent',
      termsVersion: CURRENT_TERMS_VERSION,
      acceptedAt,
    });

    const rows = await db
      .select()
      .from(schema.cpTermsAcceptance)
      .where(eq(schema.cpTermsAcceptance.userId, 'user-legal-consent'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.termsVersion, CURRENT_TERMS_VERSION);
    assert.equal(rows[0]?.acceptedAt?.toISOString(), acceptedAt.toISOString());
    assert.equal(rows[0]?.updatedAt?.toISOString(), acceptedAt.toISOString());
  });

  it('upserts the existing acceptance record for the same user', async () => {
    await recordTermsAcceptance({
      userId: 'user-legal-consent',
      termsVersion: '2026-03-01',
      acceptedAt: new Date('2026-03-09T09:00:00.000Z'),
    });

    const acceptedAt = new Date('2026-03-10T09:30:00.000Z');
    await recordTermsAcceptance({
      userId: 'user-legal-consent',
      termsVersion: CURRENT_TERMS_VERSION,
      acceptedAt,
    });

    const rows = await db
      .select()
      .from(schema.cpTermsAcceptance)
      .where(eq(schema.cpTermsAcceptance.userId, 'user-legal-consent'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.termsVersion, CURRENT_TERMS_VERSION);
    assert.equal(rows[0]?.acceptedAt?.toISOString(), acceptedAt.toISOString());
    assert.equal(rows[0]?.updatedAt?.toISOString(), acceptedAt.toISOString());
  });
});
