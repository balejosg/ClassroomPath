import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  buildInvitationExpiresAt,
  buildInvitationUrl,
  createInvitationToken,
  hashInvitationToken,
  toInvitationSummary,
} from '../src/services/invitation-shared.service.js';

describe('invitation-shared.service', () => {
  test('creates opaque invitation tokens and stable token hashes', () => {
    const firstToken = createInvitationToken();
    const secondToken = createInvitationToken();
    const firstHash = hashInvitationToken(firstToken);

    assert.ok(firstToken.length > 20);
    assert.ok(secondToken.length > 20);
    assert.notStrictEqual(firstToken, secondToken);
    assert.strictEqual(firstHash, hashInvitationToken(firstToken));
    assert.notStrictEqual(firstHash, hashInvitationToken(secondToken));
  });

  test('builds invitation URLs, expiry timestamps, and serialized summaries', () => {
    const createdAt = new Date('2026-04-10T09:00:00.000Z');
    const expiresAt = buildInvitationExpiresAt(createdAt.getTime());

    assert.ok(buildInvitationUrl('abc 123').includes('/accept-invitation?token=abc%20123'));
    assert.strictEqual(expiresAt.toISOString(), new Date('2026-04-13T09:00:00.000Z').toISOString());

    assert.deepStrictEqual(
      toInvitationSummary({
        id: 'inv-1',
        organizationId: 'org-1',
        email: 'teacher@example.com',
        name: 'Teacher Invitee',
        role: 'teacher',
        createdAt,
        expiresAt,
      }),
      {
        id: 'inv-1',
        organizationId: 'org-1',
        email: 'teacher@example.com',
        name: 'Teacher Invitee',
        role: 'teacher',
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'Pending',
      }
    );
  });
});
