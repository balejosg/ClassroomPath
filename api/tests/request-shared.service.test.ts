import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  assertPendingRequest,
  assertRequestHasGroupId,
  serializeRequestDates,
} from '../src/services/request-shared.service.js';

describe('request-shared.service', () => {
  test('assertRequestHasGroupId returns the group id and rejects missing values', () => {
    assert.strictEqual(assertRequestHasGroupId({ groupId: 'group-1' }), 'group-1');

    assert.throws(
      () => assertRequestHasGroupId({ groupId: null }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'BAD_REQUEST' &&
        error.message === 'Request has no group assigned'
    );
  });

  test('assertPendingRequest rejects non-pending states', () => {
    assert.doesNotThrow(() => assertPendingRequest({ status: 'pending' }));

    assert.throws(
      () => assertPendingRequest({ status: 'approved' }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'BAD_REQUEST' &&
        error.message === 'Request is not pending'
    );
  });

  test('serializeRequestDates converts request dates to ISO strings', () => {
    const createdAt = new Date('2026-03-10T08:00:00.000Z');
    const updatedAt = new Date('2026-03-10T09:00:00.000Z');

    assert.deepStrictEqual(
      serializeRequestDates({
        id: 'req-1',
        createdAt,
        updatedAt,
      }),
      {
        id: 'req-1',
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }
    );
  });
});
