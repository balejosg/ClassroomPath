import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  assertClassroomWriteInputName,
  normalizeCaptivePortalDomains,
  presentClassroomExemption,
} from '../src/services/classrooms/classroom-write-shared.js';

describe('classroom-write-shared', () => {
  it('trims classroom names and rejects empty values', () => {
    assert.strictEqual(assertClassroomWriteInputName('  Aula Norte  '), 'Aula Norte');
    assert.throws(() => assertClassroomWriteInputName('   '), /Classroom name is required/);
  });

  it('normalizes captive portal domains by trimming, lowercasing, and deduplicating', () => {
    assert.deepStrictEqual(
      normalizeCaptivePortalDomains([
        '  Login.School.EXAMPLE  ',
        'login.school.example',
        'WIFI.EXAMPLE',
      ]),
      ['login.school.example', 'wifi.example']
    );
  });

  it('rejects unsafe captive portal domain values', () => {
    assert.throws(
      () =>
        normalizeCaptivePortalDomains(
          Array.from({ length: 11 }, (_, index) => `wifi-${index}.example`)
        ),
      /At most 10 captive portal domains/
    );
    assert.throws(() => normalizeCaptivePortalDomains(['https://wifi.example']), /must be domains/);
    assert.throws(() => normalizeCaptivePortalDomains(['*.wifi.example']), /Wildcard/);
    assert.throws(
      () => normalizeCaptivePortalDomains(['bad_domain.example']),
      /Invalid captive portal domain/
    );
  });

  it('presents classroom exemptions with serialized timestamps', () => {
    const createdAt = new Date('2026-04-14T10:00:00.000Z');
    const expiresAt = new Date('2026-04-14T11:00:00.000Z');

    assert.deepStrictEqual(
      presentClassroomExemption({
        id: 'exempt_test',
        machineId: 'machine_1',
        classroomId: 'classroom_1',
        scheduleId: '00000000-0000-4000-8000-000000000001',
        groupId: null,
        source: 'schedule',
        reason: null,
        createdBy: 'user_1',
        createdAt,
        expiresAt,
      }),
      {
        id: 'exempt_test',
        machineId: 'machine_1',
        classroomId: 'classroom_1',
        scheduleId: '00000000-0000-4000-8000-000000000001',
        groupId: null,
        source: 'schedule',
        reason: null,
        createdBy: 'user_1',
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }
    );
  });

  it('passes through a non-null groupId on the presented classroom exemption', () => {
    const createdAt = new Date('2026-04-14T10:00:00.000Z');
    const expiresAt = new Date('2026-04-14T11:00:00.000Z');

    const presented = presentClassroomExemption({
      id: 'exempt_test_group',
      machineId: 'machine_1',
      classroomId: 'classroom_1',
      scheduleId: '00000000-0000-4000-8000-000000000002',
      groupId: 'group_1',
      source: 'schedule',
      reason: null,
      createdBy: 'user_1',
      createdAt,
      expiresAt,
    });

    assert.strictEqual(presented.groupId, 'group_1');
  });
});
