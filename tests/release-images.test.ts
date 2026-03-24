import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deriveImageRepos,
  deriveTaggedImageRefs,
  parseReleaseCandidateManifest,
  parseGitHubOwnerFromRemote,
  selectSuccessfulReleaseCandidateRun,
} from '../scripts/release-images.mjs';

describe('release image helpers', () => {
  test('parses GitHub owners from HTTPS remotes', () => {
    assert.equal(
      parseGitHubOwnerFromRemote('https://github.com/BalejosG/ClassroomPath.git'),
      'balejosg'
    );
  });

  test('parses GitHub owners from SSH remotes', () => {
    assert.equal(
      parseGitHubOwnerFromRemote('git@github.com:BalejosG/ClassroomPath.git'),
      'balejosg'
    );
  });

  test('derives immutable image repositories from the owner', () => {
    assert.deepEqual(deriveImageRepos({ repositoryOwner: 'BalejosG' }), {
      repositoryOwner: 'balejosg',
      gatewayRepo: 'ghcr.io/balejosg/classroompath-gateway',
      migrationsRepo: 'ghcr.io/balejosg/classroompath-migrations',
      openpathApiRepo: 'ghcr.io/balejosg/classroompath-openpath-api',
      spaRepo: 'ghcr.io/balejosg/classroompath-spa',
      verifierRepo: 'ghcr.io/balejosg/classroompath-release-verifier',
    });
  });

  test('derives candidate tags for a specific ClassroomPath SHA', () => {
    assert.deepEqual(
      deriveTaggedImageRefs({
        repositoryOwner: 'BalejosG',
        sha: '9765eec8fe9b1ca1dce5671406dde86bded437d8',
      }),
      {
        repositoryOwner: 'balejosg',
        gatewayRepo: 'ghcr.io/balejosg/classroompath-gateway',
        migrationsRepo: 'ghcr.io/balejosg/classroompath-migrations',
        openpathApiRepo: 'ghcr.io/balejosg/classroompath-openpath-api',
        spaRepo: 'ghcr.io/balejosg/classroompath-spa',
        verifierRepo: 'ghcr.io/balejosg/classroompath-release-verifier',
        gatewayTag:
          'ghcr.io/balejosg/classroompath-gateway:9765eec8fe9b1ca1dce5671406dde86bded437d8',
        migrationsTag:
          'ghcr.io/balejosg/classroompath-migrations:9765eec8fe9b1ca1dce5671406dde86bded437d8',
        openpathApiTag:
          'ghcr.io/balejosg/classroompath-openpath-api:9765eec8fe9b1ca1dce5671406dde86bded437d8',
        spaTag: 'ghcr.io/balejosg/classroompath-spa:9765eec8fe9b1ca1dce5671406dde86bded437d8',
        verifierTag:
          'ghcr.io/balejosg/classroompath-release-verifier:9765eec8fe9b1ca1dce5671406dde86bded437d8',
      }
    );
  });

  test('selects the newest successful release-candidate run for the exact SHA', () => {
    const run = selectSuccessfulReleaseCandidateRun(
      {
        workflow_runs: [
          {
            id: 101,
            head_sha: 'other-sha',
            event: 'push',
            conclusion: 'success',
            updated_at: '2026-03-24T08:00:00Z',
          },
          {
            id: 102,
            head_sha: 'target-sha',
            event: 'workflow_dispatch',
            conclusion: 'success',
            updated_at: '2026-03-24T09:00:00Z',
          },
          {
            id: 103,
            head_sha: 'target-sha',
            event: 'push',
            conclusion: 'failure',
            updated_at: '2026-03-24T10:00:00Z',
          },
          {
            id: 104,
            head_sha: 'target-sha',
            event: 'push',
            conclusion: 'success',
            updated_at: '2026-03-24T11:00:00Z',
          },
        ],
      },
      { sha: 'target-sha' }
    );

    assert.equal(run.id, 104);
  });

  test('parses and validates a release candidate manifest for the target SHA', () => {
    assert.deepEqual(
      parseReleaseCandidateManifest(
        [
          'APP_SHA=target-sha',
          'CLASSROOMPATH_GATEWAY_IMAGE=ghcr.io/balejosg/classroompath-gateway@sha256:1',
          'CLASSROOMPATH_MIGRATIONS_IMAGE=ghcr.io/balejosg/classroompath-migrations@sha256:2',
          'OPENPATH_API_IMAGE=ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
          'CLASSROOMPATH_SPA_IMAGE=ghcr.io/balejosg/classroompath-spa@sha256:4',
          'CLASSROOMPATH_VERIFIER_IMAGE=ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
          '',
        ].join('\n'),
        { sha: 'target-sha' }
      ),
      {
        appSha: 'target-sha',
        gatewayImage: 'ghcr.io/balejosg/classroompath-gateway@sha256:1',
        migrationsImage: 'ghcr.io/balejosg/classroompath-migrations@sha256:2',
        openpathApiImage: 'ghcr.io/balejosg/classroompath-openpath-api@sha256:3',
        spaImage: 'ghcr.io/balejosg/classroompath-spa@sha256:4',
        verifierImage: 'ghcr.io/balejosg/classroompath-release-verifier@sha256:5',
      }
    );
  });
});
