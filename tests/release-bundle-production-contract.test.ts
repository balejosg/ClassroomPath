import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');

test('production deploy consumes the exact Release Bundle and embedded contract', () => {
  const context = readFileSync(
    resolve(projectRoot, 'scripts/lib/deploy-production-context.sh'),
    'utf8'
  );
  const runtime = readFileSync(
    resolve(projectRoot, 'scripts/lib/deploy-production-runtime.sh'),
    'utf8'
  );
  const remote = readFileSync(resolve(projectRoot, 'scripts/deploy-production-remote.sh'), 'utf8');

  assert.match(context, /release-bundle\.mjs" verify/u);
  assert.match(context, /--bundle-file/u);
  assert.match(context, /--contract-file/u);
  assert.match(context, /--release-id/u);
  assert.doesNotMatch(context, /load_release_manifest_runtime/u);
  assert.match(runtime, /RELEASE_ID/u);
  assert.match(runtime, /write_release_runtime_state[\s\S]*\$OPENPATH_CONTRACT_SHA256/u);
  assert.match(remote, /release_bundle_base64/u);
  assert.match(remote, /openpath_contract_base64/u);
});

test('production bundle verification does not require Node on the host', () => {
  const context = readFileSync(
    resolve(projectRoot, 'scripts/lib/deploy-production-context.sh'),
    'utf8'
  );

  assert.match(context, /docker run[\s\S]*--entrypoint node[\s\S]*release-bundle\.mjs" verify/u);
  assert.match(context, /RELEASE_MANIFEST_B64_FROM_PAYLOAD/u);
  assert.doesNotMatch(
    context,
    /\$\(resolve_node_bin\)\s+"\$APP_DIR\/scripts\/release-bundle\.mjs"/u
  );
});

test('staging release-candidate runtime does not re-read the legacy manifest', () => {
  const staging = readFileSync(resolve(projectRoot, 'scripts/deploy-staging-remote.sh'), 'utf8');
  const localRelease = readFileSync(
    resolve(projectRoot, 'scripts/lib/staging-deploy-local-release.sh'),
    'utf8'
  );

  assert.doesNotMatch(
    staging,
    /load_release_manifest_runtime\s+"\$STAGING_RELEASE_MANIFEST_FILE"/u
  );
  assert.match(localRelease, /--run-id\s+"\$STAGING_RELEASE_RUN_ID"/u);
  assert.match(localRelease, /--release-id\s+"\$STAGING_RELEASE_ID"/u);
});

test('promotion verification and production tags bind the exact Release Bundle identity', () => {
  const verification = readFileSync(
    resolve(projectRoot, 'scripts/verify-production-promotion-ready.sh'),
    'utf8'
  );
  const tag = readFileSync(resolve(projectRoot, 'scripts/tag-production-release.sh'), 'utf8');
  const latestPromotion = readFileSync(
    resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
    'utf8'
  );

  assert.match(verification, /resolve-bundle/u);
  assert.match(verification, /verify-openpath-promotion-contract\.mjs/u);
  assert.doesNotMatch(verification, /resolve-openpath-linux-agent-version\.mjs/u);
  assert.match(verification, /EXPECTED_RELEASE_ID/u);
  assert.match(tag, /ClassroomPath-Release-Id/u);
  assert.match(tag, /ClassroomPath-RC-Run-Id/u);
  assert.match(tag, /--release-id/u);
  assert.match(tag, /--rc-run-id/u);
  assert.match(latestPromotion, /STAGING_RELEASE_ID/u);
  assert.doesNotMatch(latestPromotion, /wait-for-release-candidate\.mjs resolve-manifest/u);
});

test('rollback reads and activates the exact persisted previous Release Bundle', () => {
  const productionRollback = readFileSync(
    resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
    'utf8'
  );
  const stagingRollback = readFileSync(
    resolve(projectRoot, 'scripts/lib/staging-rollback.sh'),
    'utf8'
  );

  for (const content of [productionRollback, stagingRollback]) {
    assert.match(content, /release-bundle-state\.mjs/u);
    assert.match(content, /pointer.*previous|read.*previous/u);
    assert.match(content, /activate-previous|activate.*release/u);
    assert.match(content, /OPENPATH_LINUX_AGENT_APT_SUITE/u);
  }
  assert.match(productionRollback, /deployment_state_activate_previous_release/u);
  assert.match(stagingRollback, /ROLLBACK_RESULT="success"/u);
});
