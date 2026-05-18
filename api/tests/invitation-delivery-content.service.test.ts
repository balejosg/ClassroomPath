import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildOrganizationInvitationEmail } from '../src/services/invitation-delivery-content.service.js';

describe('invitation-delivery-content.service', () => {
  test('builds the tenant invitation email copy in English by default', () => {
    const email = buildOrganizationInvitationEmail({
      expiresAtIso: '2026-05-01T12:00:00.000Z',
      invitationUrl: 'https://classroompath.test/accept?token=abc',
      organizationName: 'Example School',
      recipientName: 'Ada Lovelace',
      role: 'teacher',
    });

    assert.match(email.subject, /Example School/);
    assert.match(email.subject, /Invitation/);
    assert.match(email.text, /Ada Lovelace/);
    assert.match(email.text, /teacher/);
    assert.match(email.text, /Activate your access here/);
    assert.match(email.text, /classroompath\.test\/accept/);
    assert.match(email.html, /<strong>teacher<\/strong>/);
  });

  test('builds Spanish tenant invitation email copy when requested', () => {
    const email = buildOrganizationInvitationEmail({
      expiresAtIso: '2026-05-01T12:00:00.000Z',
      invitationUrl: 'https://classroompath.test/accept?token=abc',
      locale: 'es-ES',
      organizationName: 'Example School',
      recipientName: 'Ada Lovelace',
      role: 'teacher',
    });

    assert.match(email.subject, /Invitación/);
    assert.match(email.text, /Activa tu acceso aquí/);
    assert.match(email.html, /Activa tu acceso/);
  });
});
