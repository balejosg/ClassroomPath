import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  buildProductionReadinessReport,
  runProductionReadiness,
} from '../scripts/lib/production-readiness.mjs';
import {
  runArtifactCheck,
  runConfigCheck,
  runHostCheck,
  runProductionReadinessCommand,
} from '../scripts/production-readiness.mjs';

const identity = {
  rcRunId: '34124312483',
  candidateSha: 'a'.repeat(40),
  releaseId: 'b'.repeat(64),
  openpathSha: 'c'.repeat(40),
  contractSha256: 'd'.repeat(64),
  recoverySha: 'e'.repeat(40),
};

describe('production readiness contract', () => {
  it('resolves an explicit RC exactly once when no duplicate identity flags are supplied', async () => {
    const stdout: string[] = [];
    let resolutions = 0;
    const result = await runProductionReadinessCommand(
      ['--rc-run-id', identity.rcRunId, '--json'],
      {
        env: { PRODUCTION_RECOVERY_SHA: identity.recoverySha },
        stdout: (value: string) => stdout.push(value),
        resolveCandidate: () => {
          resolutions += 1;
          return {
            rcRunId: identity.rcRunId,
            classroomPathSha: identity.candidateSha,
            releaseId: identity.releaseId,
            bundle: { openPath: { sourceSha: identity.openpathSha } },
            contract: { contractSha256: identity.contractSha256 },
            runtime: {},
            bundleBytes: Buffer.from('{}'),
            contractBytes: Buffer.from('{}'),
          };
        },
        checks: Object.fromEntries(
          ['rc', 'staging', 'recovery', 'config', 'host', 'artifacts'].map((name) => [
            name,
            () => ({ ok: true, message: `${name} exact` }),
          ])
        ),
      }
    );

    assert.equal(result.status, 0);
    assert.equal(resolutions, 1);
    assert.deepEqual(JSON.parse(stdout.join('')).identity, identity);
  });

  it('rejects a partial caller identity that conflicts with the explicitly resolved RC', async () => {
    let resolutions = 0;
    const result = await runProductionReadinessCommand(
      ['--rc-run-id', identity.rcRunId, '--candidate-sha', '9'.repeat(40), '--json'],
      {
        env: { PRODUCTION_RECOVERY_SHA: identity.recoverySha },
        stdout: () => {},
        stderr: () => {},
        resolveCandidate: () => {
          resolutions += 1;
          return {
            rcRunId: identity.rcRunId,
            classroomPathSha: identity.candidateSha,
            releaseId: identity.releaseId,
            bundle: { openPath: { sourceSha: identity.openpathSha } },
            contract: { contractSha256: identity.contractSha256 },
            runtime: {},
            bundleBytes: Buffer.from('{}'),
            contractBytes: Buffer.from('{}'),
          };
        },
      }
    );

    assert.equal(resolutions, 1);
    assert.equal(result.status, 2);
    assert.match(String(result.error), /candidateSha.*does not match.*RC/u);
  });

  it('preflights every immutable OCI image from the verified exact bundle', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-readiness-artifacts-'));
    const bundleFile = join(tempDir, 'bundle.json');
    const contractFile = join(tempDir, 'contract.json');
    writeFileSync(bundleFile, '{}');
    writeFileSync(contractFile, '{}');
    const images = Object.fromEntries(
      ['gateway', 'migrations', 'openpathFirefoxAssets', 'openpathApi', 'spa', 'verifier'].map(
        (name, index) => [name, `ghcr.io/example/${name}@sha256:${String(index).repeat(64)}`]
      )
    );
    const observed: string[][] = [];
    const platforms: string[] = [];
    try {
      const result = await runArtifactCheck({
        options: { bundleFile, contractFile },
        identity,
        env: { CLASSROOMPATH_CONTAINER_PLATFORM: 'linux/amd64' },
        verifyBundle: () => ({
          bundle: { openPath: { sourceSha: identity.openpathSha }, images },
          contract: { contractSha256: identity.contractSha256 },
        }),
        preflightImages: async (refs: string[]) => {
          observed.push(refs);
          return { ok: true, imageCount: refs.length };
        },
        buildManifest: () => 'exact manifest fixture\n',
        verifyPlatforms: async ({ manifestText, targetPlatform }) => {
          assert.equal(manifestText, 'exact manifest fixture\n');
          platforms.push(targetPlatform);
        },
      });

      assert.equal(result.ok, true);
      assert.deepEqual(observed, [Object.values(images)]);
      assert.deepEqual(platforms, ['linux/amd64']);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the production-specific container platform override for artifact verification', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-readiness-platform-'));
    const bundleFile = join(tempDir, 'bundle.json');
    const contractFile = join(tempDir, 'contract.json');
    writeFileSync(bundleFile, '{}');
    writeFileSync(contractFile, '{}');
    let observedPlatform = '';
    try {
      const result = await runArtifactCheck({
        options: { bundleFile, contractFile },
        identity,
        env: { CLASSROOMPATH_PRODUCTION_CONTAINER_PLATFORM: 'linux/s390x' },
        verifyBundle: () => ({
          bundle: {
            openPath: { sourceSha: identity.openpathSha },
            images: { gateway: `ghcr.io/example/gateway@sha256:${'1'.repeat(64)}` },
          },
          contract: { contractSha256: identity.contractSha256 },
        }),
        preflightImages: async () => ({ ok: true, imageCount: 1 }),
        buildManifest: () => 'exact manifest fixture\n',
        verifyPlatforms: async ({ targetPlatform }) => {
          observedPlatform = targetPlatform;
        },
      });

      assert.equal(result.ok, true);
      assert.equal(observedPlatform, 'linux/s390x');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('classifies missing production config by name without duplicating recovery validation', () => {
    const result = runConfigCheck({
      env: {
        CLASSROOMPATH_DEPLOY_ROOT: '/srv/classroompath',
        DEPLOY_USER: '',
        PRODUCTION_RECOVERY_SHA: '',
        PRODUCTION_RECOVERY_SOURCE_ROOT: '',
      },
      getTarget: () => ({
        publicUrl: 'https://prod.example.test',
        gatewayHealthUrl: 'https://prod.example.test/cp/health',
        readyUrl: 'https://prod.example.test/cp/ready',
        containerPlatform: 'linux/amd64',
      }),
      assertTargetReady: () => {},
      checkGitHub: false,
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /DEPLOY_USER/u);
    assert.doesNotMatch(result.message, /PRODUCTION_RECOVERY_SHA/u);
    assert.doesNotMatch(result.message, /PRODUCTION_RECOVERY_SOURCE_ROOT/u);
  });

  it('checks production GitHub secret and variable names without reading secret values', () => {
    const calls: string[][] = [];
    const result = runConfigCheck({
      env: {
        CLASSROOMPATH_DEPLOY_ROOT: '/srv/classroompath',
        DEPLOY_USER: 'deploy',
      },
      getTarget: () => ({
        publicUrl: 'https://prod.example.test',
        gatewayHealthUrl: 'https://prod.example.test/cp/health',
        readyUrl: 'https://prod.example.test/cp/ready',
        containerPlatform: 'linux/amd64',
      }),
      assertTargetReady: () => {},
      execFile: (_command: string, args: string[]) => {
        calls.push(args);
        if (args[0] === 'secret') {
          return [
            'DEPLOY_HOST',
            'DEPLOY_USER',
            'DEPLOY_SSH_KEY',
            'CP_PLATFORM_ADMIN_EMAILS',
            'VAPID_PUBLIC_KEY',
            'VAPID_PRIVATE_KEY',
            'VAPID_CONTACT',
          ].join('\n');
        }
        return [
          'CLASSROOMPATH_DEPLOY_ROOT',
          'CP_BILLING_MODE',
          'PRODUCTION_RECOVERY_SHA',
          'CLASSROOMPATH_PRODUCTION_PUBLIC_URL',
          'CLASSROOMPATH_PRODUCTION_GATEWAY_HEALTH_URL',
          'CLASSROOMPATH_PRODUCTION_READY_URL',
        ].join('\n');
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((args) => args.includes('list')));
    assert.ok(calls.every((args) => !args.includes('get')));
  });

  it('uses the full read-only production host contract before tagging', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = runHostCheck({
      env: {},
      cwd: '/tmp',
      execFile: (command: string, args: string[]) => calls.push({ command, args }),
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].args[0], /verify-production-host-readiness\.sh$/u);
    assert.match(calls[1].args[0], /preflight-production-promotion-target\.sh$/u);
  });

  it('classifies typed blockers without returning secret values', () => {
    const report = buildProductionReadinessReport({
      identity,
      checks: {
        rc: { ok: true, message: 'explicit RC identity is exact' },
        staging: { ok: true, message: 'staging identity is exact' },
        recovery: { ok: false, message: 'token=super-secret recovery authority unavailable' },
        config: { ok: true, message: 'runtime config is valid' },
        host: { ok: false, message: 'host contract blocked' },
        artifacts: { ok: true, message: 'artifacts are exact' },
      },
    });

    assert.equal(report.ok, false);
    assert.deepEqual(report.blockers, ['RECOVERY_BLOCKER', 'HOST_BLOCKER']);
    assert.doesNotMatch(JSON.stringify(report), /super-secret/u);
    assert.match(report.checks.recovery.message, /redacted/u);
  });

  it('runs the canonical checks in a stable order and preserves exact identity', async () => {
    const calls: string[] = [];
    const report = await runProductionReadiness({
      identity,
      checks: {
        rc: async () => {
          calls.push('rc');
          return { ok: true, message: 'RC identity is exact' };
        },
        staging: async () => {
          calls.push('staging');
          return { ok: true, message: 'staging identity is exact' };
        },
        recovery: async () => {
          calls.push('recovery');
          return { ok: true, message: 'recovery authority proven' };
        },
        config: async () => {
          calls.push('config');
          return { ok: true, message: 'config is valid' };
        },
        host: async () => {
          calls.push('host');
          return { ok: true, message: 'host contract is valid' };
        },
        artifacts: async () => {
          calls.push('artifacts');
          return { ok: true, message: 'artifacts are exact' };
        },
      },
    });

    assert.equal(report.ok, true);
    assert.deepEqual(calls, ['rc', 'staging', 'recovery', 'config', 'host', 'artifacts']);
    assert.deepEqual(report.identity, identity);
  });
});
