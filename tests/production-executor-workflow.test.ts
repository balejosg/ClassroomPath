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

test('production deployment collects read-only diagnostics after a possible switch', () => {
  assert.match(deployWorkflow, /production-deploy-diagnostics/u);
  assert.match(deployWorkflow, /if: always\(\) && needs\.deploy-production\.result == 'failure'/u);
  assert.match(deployWorkflow, /production-deployment-diagnostic\.sh/u);
  assert.match(deployWorkflow, /production-deployment-diagnostic-fallback\.sh/u);
  assert.match(deployWorkflow, /PRODUCTION_DIAGNOSTIC_FALLBACK_B64/u);
  assert.match(deployWorkflow, /diagnostic_status/u);
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
  assert.match(rollbackJob, /package-production-recovery-bundle\.sh/u);
  assert.match(rollbackJob, /PRODUCTION_RECOVERY_BUNDLE_B64/u);
  assert.match(rollbackJob, /steps\.recovery-bundle\.outputs\.bundle_base64/u);
  assert.match(rollbackJob, /envs:.*PRODUCTION_RECOVERY_BUNDLE_B64/u);
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
