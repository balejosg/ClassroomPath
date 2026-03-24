import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  deriveImageRepos,
  deriveTaggedImageRefs,
  parseGitHubOwnerFromRemote,
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
      openpathApiRepo: 'ghcr.io/balejosg/classroompath-openpath-api',
      spaRepo: 'ghcr.io/balejosg/classroompath-spa',
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
        openpathApiRepo: 'ghcr.io/balejosg/classroompath-openpath-api',
        spaRepo: 'ghcr.io/balejosg/classroompath-spa',
        gatewayTag:
          'ghcr.io/balejosg/classroompath-gateway:9765eec8fe9b1ca1dce5671406dde86bded437d8',
        openpathApiTag:
          'ghcr.io/balejosg/classroompath-openpath-api:9765eec8fe9b1ca1dce5671406dde86bded437d8',
        spaTag: 'ghcr.io/balejosg/classroompath-spa:9765eec8fe9b1ca1dce5671406dde86bded437d8',
      }
    );
  });
});
