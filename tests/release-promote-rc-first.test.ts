import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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

  it('stops the executable plan at the local tag when --local-only is selected', () => {
    const plan = buildPromotionPlan({
      rcRunId,
      tag: 'v1.2.380',
      localOnly: true,
    });

    assert.equal(plan.steps.at(-1)?.id, 'tag-production');
    assert.deepEqual(
      plan.steps
        .slice(plan.steps.findIndex((step) => step.id === 'tag-production'))
        .map((step) => step.id),
      ['tag-production']
    );
    for (const forbiddenStep of [
      'wait-production-deploy',
      'verify-production-health',
      'run-post-production-windows-canary',
      'report-residual-actions-runs',
      'print-summary',
    ]) {
      assert.equal(
        plan.steps.some((step) => step.id === forbiddenStep),
        false,
        `${forbiddenStep} must not follow a local-only tag`
      );
    }
    assert.match(formatCommand(plan.steps.at(-1)?.command), /--local-only/u);
  });

  it('keeps an explicit RC authoritative when the operator checkout is a newer HEAD', () => {
    const candidateA = 'a'.repeat(40);
    const operatorHeadB = 'b'.repeat(40);
    assert.notEqual(candidateA, operatorHeadB);

    const plan = buildPromotionPlan({
      rcRunId,
      tag: 'v1.2.380',
      localOnly: true,
    });
    const commandsById = Object.fromEntries(
      plan.steps.map((step) => [step.id, formatCommand(step.command)])
    );

    assert.match(commandsById['resolve-release-candidate'], /git cat-file -e/iu);
    assert.match(
      commandsById['resolve-release-candidate'],
      /git rev-parse "\$classroom_path_sha:upstream\/openpath"/u
    );
    assert.doesNotMatch(
      commandsById['resolve-release-candidate'],
      /test "\$classroom_path_sha" = "\$\(git rev-parse HEAD\)"/u
    );
    assert.doesNotMatch(
      commandsById['verify-clean-repos'],
      /test "\$\(git rev-parse HEAD\)" = "\$STAGING_CLASSROOMPATH_SHA"/u
    );
    assert.match(
      commandsById['verify-promotion-identity'],
      /git rev-parse "\$STAGING_CLASSROOMPATH_SHA:upstream\/openpath"/u
    );
    assert.match(
      commandsById['verify-staging-exact'],
      /--candidate-sha "\$STAGING_CLASSROOMPATH_SHA"/u
    );
    assert.match(commandsById['tag-production'], /--candidate-sha "\$STAGING_CLASSROOMPATH_SHA"/u);
  });

  it('does not mark a local-only tag as remotely published', () => {
    const tagScript = readFileSync(
      new URL('../scripts/tag-production-release.sh', import.meta.url),
      'utf8'
    );
    const localOnlyGuard = tagScript.indexOf('if [ "$PUSH_MODE" = "--local-only" ]');
    const markTagged = tagScript.indexOf('release-mark-tagged');
    const push = tagScript.indexOf('git push');

    assert.ok(localOnlyGuard >= 0, 'tag script must have a local-only exit');
    assert.ok(markTagged >= 0, 'normal remote publication must retain release fence marking');
    assert.ok(push >= 0, 'normal remote publication must retain the push operation');
    assert.ok(localOnlyGuard < markTagged, 'local-only must exit before release-mark-tagged');
    assert.ok(localOnlyGuard < push, 'local-only must exit before any push operation');
    assert.match(tagScript, /git tag -a "\$TAG_NAME" "\$EXPECTED_CANDIDATE_SHA"/u);
    assert.match(tagScript, /production_tag_reconcile_existing/u);
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
