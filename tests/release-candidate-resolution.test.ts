import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveExplicitReleaseCandidateBundle } from '../scripts/lib/release-candidate-resolution.mjs';

const classroomPathSha = 'a'.repeat(40);

test('resolves one successful push RC by explicit run id and derives its exact SHA', () => {
  const result = resolveExplicitReleaseCandidateBundle({
    repository: 'owner/repo',
    rcRunId: '34124312483',
    run: {
      databaseId: 34124312483,
      headSha: classroomPathSha,
      event: 'push',
      status: 'completed',
      conclusion: 'success',
    },
    resolveBundle: () => ({
      runId: '34124312483',
      headSha: classroomPathSha,
      releaseId: 'b'.repeat(64),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'd'.repeat(64),
      artifactName: `release-bundle-${classroomPathSha}`,
    }),
  });

  assert.equal(result.rcRunId, '34124312483');
  assert.equal(result.classroomPathSha, classroomPathSha);
  assert.equal(result.releaseId, 'b'.repeat(64));
});

test('rejects an explicit RC run that is failed, non-push, or has a different id', () => {
  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        repository: 'owner/repo',
        rcRunId: '10',
        run: {
          databaseId: 11,
          headSha: classroomPathSha,
          event: 'push',
          status: 'completed',
          conclusion: 'success',
        },
      }),
    /run id/i
  );

  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        repository: 'owner/repo',
        rcRunId: '10',
        run: {
          databaseId: 10,
          headSha: classroomPathSha,
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
        },
      }),
    /push/i
  );

  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        repository: 'owner/repo',
        rcRunId: '10',
        run: {
          databaseId: 10,
          headSha: classroomPathSha,
          event: 'push',
          status: 'completed',
          conclusion: 'failure',
        },
      }),
    /successful|conclusion/i
  );
});

test('requires a non-empty repository before resolving the exact bundle', () => {
  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        rcRunId: '10',
        run: {
          databaseId: 10,
          headSha: classroomPathSha,
          event: 'push',
          status: 'completed',
          conclusion: 'success',
        },
      }),
    /repository is required/i
  );
});
