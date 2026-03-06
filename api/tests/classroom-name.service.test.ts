import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TRPCError } from '@trpc/server';
import {
  normalizeClassroomKey,
  scopedClassroomNameForOrg,
} from '../src/services/classrooms/classroom-name.service.js';

describe('classroom-name.service', () => {
  it('normalizes classroom keys to a slug-safe value', () => {
    assert.strictEqual(normalizeClassroomKey('  Laboratorio C !!  '), 'laboratorio-c');
  });

  it('creates stable scoped classroom names per organization', () => {
    const a = scopedClassroomNameForOrg('org-a', 'Laboratorio C');
    const b = scopedClassroomNameForOrg('org-b', 'Laboratorio C');

    assert.ok(a.startsWith('cp-'));
    assert.ok(b.startsWith('cp-'));
    assert.notStrictEqual(a, b);
  });

  it('rejects names without any alphanumeric characters', () => {
    assert.throws(
      () => scopedClassroomNameForOrg('org-a', '!!!'),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        assert.strictEqual(
          error.message,
          'Classroom name must include at least one letter or number'
        );
        return true;
      }
    );
  });
});
