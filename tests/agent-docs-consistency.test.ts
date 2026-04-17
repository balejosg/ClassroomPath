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

  test('repo-hosted operational docs use the canonical public URLs', () => {
    assert.ok(
      agentsDoc.includes(deployTargets.staging.publicUrl),
      'AGENTS should reference the canonical staging public URL'
    );
    assert.ok(
      agentsDoc.includes(deployTargets.production.publicUrl),
      'AGENTS should reference the canonical production public URL'
    );
    assert.ok(
      stagingRunbook.includes(deployTargets.staging.publicUrl),
      'staging runbook should reference the canonical staging public URL'
    );
    assert.ok(
      productionRunbook.includes(deployTargets.production.publicUrl),
      'production runbook should reference the canonical production public URL'
    );
  });

  test('AGENTS documents local staging deploys and tag-only production promotion', () => {
    assert.ok(
      agentsDoc.includes('npm run deploy:staging'),
      'AGENTS should document the local staging deployment command'
    );
    assert.ok(
      agentsDoc.includes('npm run promote:production -- v1.2.4'),
      'AGENTS should document the canonical production promotion command'
    );
    assert.ok(
      agentsDoc.includes('verify staging evidence'),
      'AGENTS should require verifying staging evidence before production tagging'
    );
    assert.ok(
      agentsDoc.includes('annotated tag') && agentsDoc.includes('Promotion evidence'),
      'AGENTS should explain that production tags carry embedded staging evidence'
    );
    assert.match(
      agentsDoc,
      /Production server images require linux\/arm64[\s\S]*Endpoint client\s+arm64 builds are discontinued for now/,
      'AGENTS should distinguish server ARM64 from discontinued endpoint client ARM64 builds'
    );
  });

  test('documented gateway health endpoints match deploy targets', () => {
    assert.ok(
      agentsDoc.includes(deployTargets.staging.gatewayHealthUrl),
      'AGENTS should use the canonical staging gateway health URL'
    );
    assert.ok(
      agentsDoc.includes(deployTargets.production.gatewayHealthUrl),
      'AGENTS should use the canonical production gateway health URL'
    );
    assert.ok(
      stagingRunbook.includes(deployTargets.staging.gatewayHealthUrl),
      'staging runbook should use the canonical staging gateway health URL'
    );
    assert.ok(
      productionRunbook.includes(deployTargets.production.gatewayHealthUrl),
      'production runbook should use the canonical production gateway health URL'
    );

    assert.ok(
      productionRunbook.includes(deployTargets.production.readyUrl),
      'production runbook should reference the canonical production ready URL'
    );
  });

  test('repo-hosted docs reject stale production duckdns and /api/health guidance', () => {
    for (const [label, content] of [
      ['AGENTS.md', agentsDoc],
      ['docs/runbooks/deploy-staging.md', stagingRunbook],
      ['docs/runbooks/deploy-production.md', productionRunbook],
    ] as const) {
      assert.ok(
        !content.includes('classroompath.duckdns.org'),
        `${label} should not reference the retired production duckdns hostname`
      );
      assert.ok(
        !content.includes('/api/health'),
        `${label} should not reference the stale /api/health endpoint`
      );
    }
  });
});
