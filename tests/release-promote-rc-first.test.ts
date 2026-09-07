import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { buildPromotionPlan, formatCommand } from '../scripts/lib/release-orchestration.mjs';
import {
  assertPromotionResumeIdentity,
  parseReleasePromoteArgs,
  runReleasePromoteCommand,
} from '../scripts/release-promote.mjs';

const rcRunId = '34124312483';

describe('release:promote RC-first contract', () => {
  it('requires an explicit successful release-candidate run before planning', async () => {
    let stderr = '';

    const result = await runReleasePromoteCommand(['--tag', 'v1.2.380', '--dry-run'], {
      stdout: () => {},
      stderr: (value) => {
        stderr += value;
      },
    });

    assert.equal(result.status, 2);
    assert.match(stderr, /--rc-run-id is required/u);
  });

  it('parses the explicit release-candidate run id', () => {
    const options = parseReleasePromoteArgs(['--rc-run-id', rcRunId, '--auto-tag', '--dry-run']);

    assert.equal(options.rcRunId, rcRunId);
    assert.equal(options.autoTag, true);
  });

  it('keys resumable state by RC identity and orders staging before production readiness', () => {
    const transcriptRoot = mkdtempSync(join(tmpdir(), 'release-promote-rc-first-'));
    const plan = buildPromotionPlan({
      rcRunId,
      tag: 'v1.2.380',
      transcriptRoot,
      highRiskWindows: false,
      postProductionWindowsCanary: false,
    });

    assert.equal(plan.rcRunId, rcRunId);
    assert.equal(plan.identityRoot, join(transcriptRoot, `rc-${rcRunId}`));
    assert.equal(plan.releaseBundleStateDir, join(transcriptRoot, `rc-${rcRunId}`, 'bundle'));
    assert.deepEqual(
      plan.steps.map((step) => step.id),
      [
        'resolve-release-candidate',
        'verify-clean-repos',
        'verify-promotion-identity',
        'deploy-staging',
        'verify-staging-exact',
        'production-readiness',
        'release-preflight',
        'approval',
        'tag-production',
        'wait-production-deploy',
        'verify-production-health',
        'report-residual-actions-runs',
        'print-summary',
      ]
    );

    const commandsById = Object.fromEntries(
      plan.steps.map((step) => [step.id, formatCommand(step.command)])
    );
    assert.match(commandsById['resolve-release-candidate'], /--rc-run-id 34124312483/u);
    assert.doesNotMatch(commandsById['resolve-release-candidate'], /origin\/main/u);
    assert.match(commandsById['deploy-staging'], /deploy:staging.*--rc-run-id/u);
    assert.match(commandsById['production-readiness'], /verify:production-readiness/u);
    assert.match(commandsById['production-readiness'], /--rc-run-id/u);
    assert.match(commandsById['tag-production'], /--rc-run-id "\$STAGING_RELEASE_RUN_ID"/u);
  });

  it('rejects resume when any immutable RC identity changes', () => {
    const state = {
      tag: 'v1.2.380',
      rcRunId,
      classroomPathSha: 'a'.repeat(40),
      releaseId: 'b'.repeat(64),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'd'.repeat(64),
    };
    const locator = {
      rcRunId,
      classroomPathSha: 'a'.repeat(40),
      releaseId: 'b'.repeat(64),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'e'.repeat(64),
    };

    assert.throws(
      () => assertPromotionResumeIdentity({ state, locator, tag: 'v1.2.380', rcRunId }),
      /contract SHA-256/u
    );
  });
});
