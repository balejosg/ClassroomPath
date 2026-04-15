import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  assertClassroomWriteInputName,
  presentClassroomExemption,
} from '../src/services/classrooms/classroom-write-shared.js';

describe('classroom-write-shared', () => {
  it('trims classroom names and rejects empty values', () => {
    assert.strictEqual(assertClassroomWriteInputName('  Aula Norte  '), 'Aula Norte');
    assert.throws(() => assertClassroomWriteInputName('   '), /Classroom name is required/);
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
        createdBy: 'user_1',
        createdAt,
        expiresAt,
      }),
      {
        id: 'exempt_test',
        machineId: 'machine_1',
        classroomId: 'classroom_1',
        scheduleId: '00000000-0000-4000-8000-000000000001',
        createdBy: 'user_1',
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }
    );
  });
});
