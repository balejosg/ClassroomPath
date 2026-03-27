import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveWorkflowRunId } from '../scripts/wait-for-release-candidate.mjs';

describe('wait-for-release-candidate helpers', () => {
  test('uses databaseId from gh run list payloads when id is absent', () => {
    assert.equal(resolveWorkflowRunId({ databaseId: 123 }), 123);
  });

  test('prefers explicit id when present', () => {
    assert.equal(resolveWorkflowRunId({ id: 456, databaseId: 123 }), 456);
  });
});
