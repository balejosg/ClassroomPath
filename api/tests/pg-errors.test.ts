import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TRPCError } from '@trpc/server';
import { isPgUniqueViolation, throwConflictOnUniqueViolation } from '../src/lib/pg-errors.js';

describe('pg-errors', () => {
  it('detects Postgres unique violation by SQLSTATE code', () => {
    assert.strictEqual(
      isPgUniqueViolation({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      }),
      true
    );
  });

  it('detects unique constraint violations by message fallback', () => {
    assert.strictEqual(
      isPgUniqueViolation({
        message: 'duplicate key value violates UNIQUE CONSTRAINT users_email',
      }),
      true
    );
  });

  it('does not flag non-unique database errors', () => {
    assert.strictEqual(
      isPgUniqueViolation({ code: '22P02', message: 'invalid input syntax for type uuid' }),
      false
    );
  });

  it('maps unique violations to TRPC CONFLICT', () => {
    assert.throws(
      () =>
        throwConflictOnUniqueViolation(
          { code: '23505', message: 'duplicate key value violates unique constraint' },
          'Already exists'
        ),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'CONFLICT');
        assert.strictEqual(error.message, 'Already exists');
        return true;
      }
    );
  });

  it('rethrows non-unique errors unchanged', () => {
    const original = new Error('boom');

    assert.throws(
      () => throwConflictOnUniqueViolation(original, 'Already exists'),
      (error) => error === original
    );
  });
});
