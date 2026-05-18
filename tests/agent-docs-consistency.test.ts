import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

type DeployTarget = {
  publicUrl: string;
  gatewayHealthUrl: string;
  readyUrl: string;
  apiHealthUrl: string;
  apiConfigUrl: string;
};

type DeployTargets = {
  staging: DeployTarget;
  production: DeployTarget;
};

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

function readText(relativePath: string): string {
  const filePath = resolve(projectRoot, relativePath);
  assert.ok(existsSync(filePath), `${relativePath} should exist`);
  return readFileSync(filePath, 'utf-8');
}

function readDeployTargets(): DeployTargets {
  return JSON.parse(readText('config/deploy-targets.json')) as DeployTargets;
}

describe('Agent docs consistency', () => {
  const deployTargets = readDeployTargets();
  const agentsDoc = readText('AGENTS.md');
  const stagingRunbook = readText('docs/runbooks/deploy-staging.md');
  const productionRunbook = readText('docs/runbooks/deploy-production.md');

  test('repo-hosted operational docs avoid canonical deploy targets in public guidance', () => {
    assert.ok(
      agentsDoc.includes('config/deploy-targets.local.json'),
      'AGENTS should point maintainers to private deploy target config'
    );
    assert.ok(
      stagingRunbook.includes('config/deploy-targets.local.json'),
      'staging runbook should point maintainers to private deploy target config'
    );
    assert.ok(
      productionRunbook.includes('operational material'),
      'production runbook should be a public operational stub'
    );
  });

  test('AGENTS documents public low-profile safeguards', () => {
    assert.ok(
      agentsDoc.includes('Do not publish live deployment targets'),
      'AGENTS should prohibit publishing operational target details'
    );
    assert.ok(
      agentsDoc.includes('Do not run staging deploys'),
      'AGENTS should prohibit deploys during public-surface work'
    );
    assert.ok(
      agentsDoc.includes('OpenPath is the OSS core'),
      'AGENTS should route community work to OpenPath'
    );
    assert.ok(
      agentsDoc.includes('verify:public-surface'),
      'AGENTS should include the public surface verification command'
    );
  });

  test('public deploy target placeholders remain non-live', () => {
    assert.ok(
      deployTargets.staging.publicUrl.includes('.invalid'),
      'staging target should be a placeholder'
    );
    assert.ok(
      deployTargets.production.publicUrl.includes('.invalid'),
      'production target should be a placeholder'
    );
    assert.ok(
      deployTargets.staging.gatewayHealthUrl.includes('.invalid'),
      'staging health target should be a placeholder'
    );
    assert.ok(
      deployTargets.production.gatewayHealthUrl.includes('.invalid'),
      'production health target should be a placeholder'
    );
  });

  test('repo-hosted docs reject stale production duckdns and /api/health guidance', () => {
    for (const [label, content] of [
      ['AGENTS.md', agentsDoc],
      ['docs/runbooks/deploy-staging.md', stagingRunbook],
      ['docs/runbooks/deploy-production.md', productionRunbook],
    ] as const) {
      assert.ok(
        !content.includes('classroompath.example.invalid'),
        `${label} should not reference the retired production duckdns hostname`
      );
      assert.ok(
        !content.includes('/api/health'),
        `${label} should not reference the stale /api/health endpoint`
      );
    }
  });
});
