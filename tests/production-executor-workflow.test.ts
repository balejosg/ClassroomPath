import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const deployWorkflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf8');
const smokeWorkflow = readFileSync(
  resolve(projectRoot, '.github/workflows/smoke-tests.yml'),
  'utf8'
);
const rollbackScript = readFileSync(
  resolve(projectRoot, 'scripts/lib/production-recovery-executor.sh'),
  'utf8'
);
const rollbackExecutorHelper = readFileSync(
  resolve(projectRoot, 'scripts/lib/rollback-executor.sh'),
  'utf8'
);

test('production deployment collects read-only diagnostics after a possible switch', () => {
  assert.match(deployWorkflow, /production-deploy-diagnostics/u);
  assert.match(deployWorkflow, /if: always\(\) && needs\.deploy-production\.result == 'failure'/u);
  assert.match(deployWorkflow, /production-deployment-diagnostic\.sh/u);
  assert.match(deployWorkflow, /production-deployment-diagnostic-fallback\.sh/u);
  assert.match(deployWorkflow, /PRODUCTION_DIAGNOSTIC_FALLBACK_B64/u);
  assert.match(deployWorkflow, /prepare-production-recovery\.outputs\.diagnostic_fallback_base64/u);
  assert.match(deployWorkflow, /diagnostic_status/u);
  assert.match(deployWorkflow, /candidate_diagnostic_valid/u);
  assert.match(deployWorkflow, /production-deployment-diagnostic\.sh.*diagnostic_status=0/u);
  assert.match(deployWorkflow, /candidate_diagnostic_valid=1/u);
  assert.match(deployWorkflow, /mutation_boundary_reached/u);
  assert.doesNotMatch(
    deployWorkflow,
    /diagnostic-unavailable.*mutation_boundary_reached\\":false/u
  );
  assert.match(deployWorkflow, /Upload production deploy diagnostics/u);
  assert.match(deployWorkflow, /diagnostic smoke|failure diagnostic/iu);
});

test('production rollback transmits a stable recovery bundle to the streamed entrypoint', () => {
  const rollbackJob = deployWorkflow.match(
    /  rollback-production:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u
  )?.[0];

  assert.ok(rollbackJob, 'rollback production job should be present');
  assert.match(rollbackJob, /PRODUCTION_RECOVERY_BUNDLE_B64/u);
  assert.match(rollbackJob, /needs\.prepare-production-recovery\.outputs\.bundle_base64/u);
  assert.match(rollbackJob, /needs\.prepare-production-recovery\.outputs\.artifact_sha256/u);
  assert.doesNotMatch(rollbackJob, /package-production-recovery-bundle\.sh/u);
  assert.match(rollbackJob, /download-artifact@v7/u);
  assert.match(rollbackJob, /envs:.*PRODUCTION_RECOVERY_BUNDLE_B64/u);
});

test('recovery artifact is packaged before deploy and the exact bytes are shared with rollback', () => {
  const recoveryJob = deployWorkflow.match(
    /  prepare-production-recovery:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u
  )?.[0];
  const deployJob = deployWorkflow.match(/  deploy-production:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u)?.[0];
  const rollbackJob = deployWorkflow.match(
    /  rollback-production:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u
  )?.[0];

  assert.ok(recoveryJob, 'recovery artifact preparation job should be present');
  assert.ok(deployJob, 'production deploy job should be present');
  assert.ok(rollbackJob, 'production rollback job should be present');
  assert.match(recoveryJob, /package-production-recovery-bundle\.sh/u);
  assert.match(recoveryJob, /sha256sum/u);
  assert.match(recoveryJob, /artifact_sha256/u);
  assert.match(recoveryJob, /executor_sha256/u);
  assert.match(recoveryJob, /bundle_base64/u);
  assert.match(recoveryJob, /production-deployment-diagnostic-fallback\.sh/u);
  assert.match(deployJob, /prepare-production-recovery/u);
  assert.match(deployJob, /PRODUCTION_RECOVERY_BUNDLE_B64/u);
  assert.match(deployJob, /PRODUCTION_RECOVERY_ARTIFACT_SHA256/u);
  assert.match(deployJob, /PRODUCTION_RECOVERY_EXECUTOR_SHA256/u);
  assert.match(rollbackJob, /prepare-production-recovery/u);
  assert.match(rollbackJob, /PRODUCTION_RECOVERY_ARTIFACT_SHA256/u);
  assert.match(rollbackJob, /PRODUCTION_RECOVERY_EXECUTOR_SHA256/u);
  assert.doesNotMatch(rollbackJob, /actions\/checkout|Checkout/u);
});

test('recovery executor exposes a no-mutation preflight and persists its artifact identity', () => {
  assert.match(rollbackScript, /PRODUCTION_RECOVERY_PREFLIGHT_ONLY/u);
  assert.match(rollbackScript, /rollback_executor_preflight/u);
  assert.match(rollbackExecutorHelper, /ROLLBACK_RECOVERY_ARTIFACT_SHA256/u);
  assert.match(rollbackScript, /MUTATION_BOUNDARY_REACHED/u);
  assert.match(
    readFileSync(resolve(projectRoot, 'scripts/lib/production-recovery-artifact.sh'), 'utf8'),
    /production_recovery_artifact_prepare/u
  );
});

test('scheduled staging and production smoke resolution have independent gates', () => {
  assert.match(
    smokeWorkflow,
    /resolve-production-release:[\s\S]*if: .*github\.event_name == 'schedule'/u
  );
  assert.match(
    smokeWorkflow,
    /smoke-test-production:[\s\S]*if: .*github\.event_name == 'schedule'/u
  );
  const productionResolverBlock = smokeWorkflow.match(
    /  resolve-production-release:[\s\S]*?(?=\n  [a-z0-9-]+:|$)/u
  )?.[0];
  assert.ok(productionResolverBlock, 'production resolver job should be present');
  assert.doesNotMatch(productionResolverBlock, /needs:\s*\[?resolve-staging-release/u);
  assert.match(smokeWorkflow, /staging_result=.*needs\.smoke-test-staging\.result/u);
  assert.match(smokeWorkflow, /production_result=.*needs\.smoke-test-production\.result/u);
});

test('rollback workflow is a no-op when the forward executor failed before switching', () => {
  assert.match(rollbackScript, /ROLLBACK_USES_V2:-0.*MUTATION_BOUNDARY_REACHED:-0/su);
  assert.match(
    rollbackScript,
    /Production deploy failed before the mutation boundary; no rollback is required[\s\S]*?exit 0/u
  );
});
