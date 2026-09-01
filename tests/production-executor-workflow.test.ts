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
  resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
  'utf8'
);

test('production deployment collects read-only diagnostics after a possible switch', () => {
  assert.match(deployWorkflow, /production-deploy-diagnostics/u);
  assert.match(deployWorkflow, /if: always\(\) && needs\.deploy-production\.result == 'failure'/u);
  assert.match(deployWorkflow, /production-deployment-diagnostic\.sh/u);
  assert.match(deployWorkflow, /mutation_boundary_reached/u);
  assert.match(deployWorkflow, /Upload production deploy diagnostics/u);
  assert.match(deployWorkflow, /diagnostic smoke|failure diagnostic/iu);
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
  assert.match(
    rollbackScript,
    /MUTATION_BOUNDARY_REACHED:-0.*Production deploy failed before the mutation boundary/su
  );
  assert.match(
    rollbackScript,
    /Production deploy failed before the mutation boundary; no rollback is required[\s\S]*?exit 0/u
  );
});
