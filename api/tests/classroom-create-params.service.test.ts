import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeCreateClassroomParams } from '../src/services/classrooms/classroom-create-params.service.js';

describe('classroom-create-params.service', () => {
  test('normalizes the classroom create input', () => {
    const normalized = normalizeCreateClassroomParams({
      ctx: {
        organizationId: 'org_123',
        user: { sub: 'user_123' },
      } as never,
      input: {
        name: '  Aula Principal  ',
        displayName: ' Aula Principal ',
        captivePortalDomains: [' Portal.School.EXAMPLE ', 'portal.school.example'],
      },
    });

    assert.equal(normalized.publicName, 'Aula Principal');
    assert.equal(normalized.displayName, 'Aula Principal');
    assert.equal(normalized.organizationId, 'org_123');
    assert.equal(normalized.userId, 'user_123');
    assert.deepEqual(normalized.captivePortalDomains, ['portal.school.example']);
    assert.match(normalized.scopedName, /^cp-[a-f0-9]{10}-aula-principal-[a-f0-9]{8}$/);
  });
});
