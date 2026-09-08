import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  RELEASE_BUNDLE_IMAGE_NAMES,
  buildReleaseBundle,
  buildReleaseBundleArtifacts,
} from '../scripts/lib/release-bundle.mjs';
import { runCandidateToolingCompatibility } from '../scripts/verify-candidate-tooling.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const contractShaPlaceholder = 'b'.repeat(64);
const digest = 'a'.repeat(64);

function git(fixtureRoot, ...args) {
  return execFileSync('git', ['-C', fixtureRoot, ...args], { encoding: 'utf8' }).trim();
}

function buildContract(openpathSha) {
  return {
    schemaVersion: 2,
    openpathSha,
    openpathVersion: '4.1.0',
    interfaces: {
      wrapperIntegration: 1,
      windowsOfflineInstaller: 1,
      readiness: 1,
    },
    components: {
      linuxAgent: {
        sourceSha: openpathSha,
        inputsSha256: contractShaPlaceholder,
        packageName: 'openpath-dnsmasq',
        packageVersion: '0.0.20260830211724-1',
        aptSuite: 'unstable',
        filename: 'pool/unstable/main/openpath-dnsmasq.deb',
        sha256: contractShaPlaceholder,
      },
      windowsOfflineInstaller: {
        sourceSha: openpathSha,
        inputsSha256: contractShaPlaceholder,
        version: '4.1.0',
        releaseTag: 'scripts-v4.1.0-a3846d6',
        templateAsset: 'OpenPath-Windows-Setup-Template.exe',
        templateSha256: contractShaPlaceholder,
        payloadManifestAsset: 'payload-manifest.json',
        payloadManifestSha256: contractShaPlaceholder,
      },
      browserPolicy: {
        sourceSha: openpathSha,
        inputsSha256: contractShaPlaceholder,
        firefoxExtensionVersion: '2.0.1',
        browserPolicySpecSha256: contractShaPlaceholder,
      },
    },
  };
}

function buildArtifacts(candidateSha, openpathSha, artifactRoot) {
  const contractBytes = Buffer.from(JSON.stringify(buildContract(openpathSha), null, 2) + '\n');
  const contractSha256 = createHash('sha256').update(contractBytes).digest('hex');
  const bundle = buildReleaseBundle({
    classroomPathSha: candidateSha,
    openPath: { sourceSha: openpathSha, contractSha256 },
    images: Object.fromEntries(
      RELEASE_BUNDLE_IMAGE_NAMES.map((name) => [
        name,
        `ghcr.io/balejosg/classroompath-${name}@sha256:${digest}`,
      ])
    ),
  });
  const artifact = buildReleaseBundleArtifacts({ bundle, contractBytes });
  const bundlePath = join(artifactRoot, 'classroompath-release-bundle.json');
  const contractPath = join(artifactRoot, 'openpath-promotion-contract.json');
  writeFileSync(bundlePath, artifact.bundleBytes);
  writeFileSync(contractPath, contractBytes);
  return { bundlePath, contractPath, releaseId: artifact.releaseId, contractSha256 };
}

function createFixture({ incompatibleCandidate = false, brokenOperatorBundle = false } = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'classroompath-candidate-tooling-fixture-'));
  execFileSync('git', ['clone', '--quiet', projectRoot, fixtureRoot], { stdio: 'ignore' });
  execFileSync('git', ['-C', fixtureRoot, 'config', 'user.name', 'Candidate tooling fixture']);
  execFileSync('git', ['-C', fixtureRoot, 'config', 'user.email', 'fixture@example.invalid']);

  const originalEvidence = readFileSync(
    join(fixtureRoot, 'scripts/promotion-evidence-cli.mjs'),
    'utf8'
  );
  const originalBundle = readFileSync(join(fixtureRoot, 'scripts/release-bundle.mjs'), 'utf8');
  writeFileSync(join(fixtureRoot, 'candidate-a-marker.txt'), 'candidate A\n');

  if (incompatibleCandidate) {
    writeFileSync(
      join(fixtureRoot, 'scripts/promotion-evidence-cli.mjs'),
      originalEvidence.replace(
        'function main(argv) {',
        "if (process.argv[2] === 'verify-tag-identity') throw new Error('candidate A tag schema is incompatible');\n\nfunction main(argv) {"
      )
    );
  }
  const candidateSha = git(fixtureRoot, 'rev-parse', 'HEAD');
  execFileSync('git', [
    '-C',
    fixtureRoot,
    'add',
    'candidate-a-marker.txt',
    'scripts/promotion-evidence-cli.mjs',
  ]);
  execFileSync('git', ['-C', fixtureRoot, 'commit', '--quiet', '-m', 'candidate A']);
  const actualCandidateSha = git(fixtureRoot, 'rev-parse', 'HEAD');

  if (brokenOperatorBundle) {
    writeFileSync(
      join(fixtureRoot, 'scripts/release-bundle.mjs'),
      originalBundle.replace(
        'export async function runReleaseBundleCommand',
        "if (process.argv[2] === 'verify') throw new Error('operator B release-bundle helper must not run');\n\nexport async function runReleaseBundleCommand"
      )
    );
  } else if (incompatibleCandidate) {
    writeFileSync(join(fixtureRoot, 'scripts/promotion-evidence-cli.mjs'), originalEvidence);
  }

  execFileSync('git', ['-C', fixtureRoot, 'add', 'scripts']);
  execFileSync('git', ['-C', fixtureRoot, 'commit', '--quiet', '-m', 'operator tooling B']);
  const operatorHead = git(fixtureRoot, 'rev-parse', 'HEAD');
  const openpathSha = git(fixtureRoot, 'rev-parse', `${actualCandidateSha}:upstream/openpath`);
  const artifactRoot = mkdtempSync(join(tmpdir(), 'classroompath-candidate-tooling-artifacts-'));
  const artifacts = buildArtifacts(actualCandidateSha, openpathSha, artifactRoot);
  const stagingCurrent = join(artifactRoot, 'staging-current-images.env');
  const stagingVerification = join(artifactRoot, 'staging-verification.env');
  writeFileSync(stagingCurrent, `APP_SHA=${actualCandidateSha}\n`);
  writeFileSync(stagingVerification, `STAGING_VERIFIED_APP_SHA=${actualCandidateSha}\n`);

  return {
    fixtureRoot,
    artifactRoot,
    candidateSha: actualCandidateSha,
    operatorHead,
    openpathSha,
    ...artifacts,
    stagingCurrent,
    stagingVerification,
  };
}

function cleanupFixture(fixture) {
  rmSync(fixture.artifactRoot, { recursive: true, force: true });
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}

function compatibilityOptions(fixture) {
  return {
    repoRoot: fixture.fixtureRoot,
    candidateSha: fixture.candidateSha,
    rcRunId: '34124312483',
    tag: 'v9.9.9',
    releaseId: fixture.releaseId,
    openpathSha: fixture.openpathSha,
    contractSha256: fixture.contractSha256,
    bundleFile: fixture.bundlePath,
    contractFile: fixture.contractPath,
    stagingCurrent: fixture.stagingCurrent,
    stagingVerification: fixture.stagingVerification,
  };
}

test('candidate-owned compatibility uses A worktree helpers while operator tooling is B', async () => {
  const fixture = createFixture({ brokenOperatorBundle: true });
  try {
    assert.notEqual(fixture.candidateSha, fixture.operatorHead);
    const result = await runCandidateToolingCompatibility(compatibilityOptions(fixture));

    assert.equal(result.candidateSha, fixture.candidateSha);
    assert.equal(result.candidateOpenpathSha, fixture.openpathSha);
    assert.deepEqual(result.checks, [
      'release-bundle-v2',
      'promotion-tag-identity',
      'production-readiness-contract',
    ]);
    assert.match(result.tagMessage, /ClassroomPath-RC-Run-Id: 34124312483/u);
    assert.doesNotMatch(
      git(fixture.fixtureRoot, 'worktree', 'list', '--porcelain'),
      /\/candidate\n/u
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test('incompatible candidate tooling blocks before any local or remote tag exists', async () => {
  const fixture = createFixture({ incompatibleCandidate: true });
  try {
    await assert.rejects(
      runCandidateToolingCompatibility(compatibilityOptions(fixture)),
      /candidate A tag schema is incompatible/u
    );
    assert.equal(git(fixture.fixtureRoot, 'tag', '--list', 'v9.9.9'), '');
    assert.equal(git(fixture.fixtureRoot, 'ls-remote', '--tags', 'origin', 'refs/tags/v9.9.9'), '');
    assert.doesNotMatch(
      git(fixture.fixtureRoot, 'worktree', 'list', '--porcelain'),
      /\/candidate\n/u
    );
  } finally {
    cleanupFixture(fixture);
  }
});
