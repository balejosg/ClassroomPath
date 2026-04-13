/**
 * Remote Deploy Bootstrap Tests
 *
 * Contracts for streamed staging/production deploy scripts that must work even
 * when the checked-out helper files on the target host are older than the script.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractShellFunction } from './helpers/ops-contracts.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

void describe('Remote Deploy Bootstrap', () => {
  const remoteBootstrapHelperPath = resolve(projectRoot, 'scripts/lib/remote-bootstrap.sh');
  const remoteHelperContractsPath = resolve(projectRoot, 'scripts/lib/remote-helper-contracts.sh');
  const releaseManifestHelperPath = resolve(projectRoot, 'scripts/lib/release-manifest.sh');
  const releaseManifestCompatHelperPath = resolve(
    projectRoot,
    'scripts/lib/release-manifest-compat.sh'
  );
  const deployPayloadHelperPath = resolve(projectRoot, 'scripts/lib/deploy-payload.sh');
  const releaseStateCompatHelperPath = resolve(projectRoot, 'scripts/lib/release-state-compat.sh');
  const stagingRemotePath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const productionRemotePath = resolve(projectRoot, 'scripts/deploy-production-remote.sh');
  const rollbackRemotePath = resolve(projectRoot, 'scripts/rollback-production-remote.sh');
  const persistVerificationRemotePath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );

  void test('remote bootstrap helper owns script-dir and helper-path resolution', () => {
    const content = readFileSync(remoteBootstrapHelperPath, 'utf-8');
    const helperContractsContent = readFileSync(remoteHelperContractsPath, 'utf-8');

    assert.ok(
      existsSync(remoteBootstrapHelperPath),
      'scripts/lib/remote-bootstrap.sh should exist'
    );
    assert.ok(
      existsSync(remoteHelperContractsPath),
      'scripts/lib/remote-helper-contracts.sh should exist'
    );
    assert.ok(
      existsSync(releaseManifestCompatHelperPath),
      'scripts/lib/release-manifest-compat.sh should exist'
    );
    assert.ok(
      existsSync(releaseStateCompatHelperPath),
      'scripts/lib/release-state-compat.sh should exist'
    );
    assert.ok(
      content.includes('resolve_remote_script_dir()') &&
        content.includes('resolve_remote_helper_path()') &&
        content.includes('reload_deployed_common_helpers()') &&
        content.includes('run_remote_deploy_phases()'),
      'remote-bootstrap.sh should own shared remote helper resolution functions'
    );
    assert.ok(
      helperContractsContent.includes('remote_helper_path_supports_all()') &&
        helperContractsContent.includes('remote_helper_contract_version()') &&
        helperContractsContent.includes('remote_helper_contract_version_at_least()') &&
        helperContractsContent.includes('refresh_deployed_release_helpers()') &&
        helperContractsContent.includes(
          'release_state_helper_supports_staging_verification_contract()'
        ),
      'remote-helper-contracts.sh should own version-first streamed-helper contract guards and post-checkout refresh logic'
    );
  });

  void test('remote helper libraries publish explicit contract versions', () => {
    for (const helperPath of [
      releaseManifestHelperPath,
      releaseManifestCompatHelperPath,
      releaseStateCompatHelperPath,
      resolve(projectRoot, 'scripts/lib/release-state.sh'),
      resolve(projectRoot, 'scripts/lib/deployment-state.sh'),
      resolve(projectRoot, 'scripts/lib/release-runtime.sh'),
    ]) {
      const content = readFileSync(helperPath, 'utf-8');
      assert.match(
        content,
        /HELPER_CONTRACT_VERSION=[0-9]+/,
        `${helperPath} should publish a numeric helper contract version`
      );
    }
  });

  void test('inline deploy payload fallbacks stay byte-for-byte aligned with source helpers', () => {
    const deployPayloadHelper = readFileSync(deployPayloadHelperPath, 'utf-8');

    const mirroredFunctions = [
      ['decode_deploy_payload_base64', deployPayloadHelper],
      ['deploy_payload_get', deployPayloadHelper],
    ] as const;

    for (const relativePath of [
      'scripts/deploy-staging-remote.sh',
      'scripts/deploy-production-remote.sh',
    ]) {
      const content = readFileSync(resolve(projectRoot, relativePath), 'utf-8');

      for (const [functionName, helperContent] of mirroredFunctions) {
        assert.strictEqual(
          extractShellFunction(content, functionName),
          extractShellFunction(helperContent, functionName),
          `${relativePath} inline ${functionName}() fallback should match the source helper`
        );
      }
    }
  });

  void test('shared remote manifest compatibility helper owns the fallback manifest contract', () => {
    const releaseManifestHelper = readFileSync(releaseManifestHelperPath, 'utf-8');
    const releaseManifestCompatHelper = readFileSync(releaseManifestCompatHelperPath, 'utf-8');

    for (const functionName of [
      'release_manifest_get',
      'release_manifest_require_key',
      'decode_release_manifest_base64',
      'release_manifest_validate_contract',
      'export_release_manifest_runtime_env',
    ] as const) {
      assert.strictEqual(
        extractShellFunction(releaseManifestCompatHelper, functionName),
        extractShellFunction(releaseManifestHelper, functionName),
        `release-manifest-compat.sh fallback ${functionName}() should match the primary release-manifest helper`
      );
    }
  });

  void test('staging and production resolve release-runtime through the shared bootstrap helper', () => {
    for (const relativePath of [
      'scripts/deploy-staging-remote.sh',
      'scripts/deploy-production-remote.sh',
    ]) {
      const content = readFileSync(resolve(projectRoot, relativePath), 'utf-8');

      assert.ok(
        content.includes(
          'RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/release-runtime.sh")"'
        ),
        `${relativePath} should resolve release-runtime.sh through resolve_remote_helper_path`
      );
      assert.ok(
        !content.includes('RELEASE_RUNTIME_HELPER_PATH="$SCRIPT_DIR/lib/release-runtime.sh"'),
        `${relativePath} should not duplicate release-runtime.sh path selection inline`
      );
    }
  });

  void test('staging and production retain inline bootstrap fallback for older remote checkouts', () => {
    const stagingRemote = readFileSync(stagingRemotePath, 'utf-8');
    const productionRemote = readFileSync(productionRemotePath, 'utf-8');

    for (const [name, content] of [
      ['deploy-staging-remote.sh', stagingRemote],
      ['deploy-production-remote.sh', productionRemote],
    ] as const) {
      assert.ok(
        content.includes('if [ -f "$REMOTE_BOOTSTRAP_HELPER_PATH" ]; then') &&
          content.includes('source "$REMOTE_BOOTSTRAP_HELPER_PATH"') &&
          content.includes('resolve_remote_script_dir() {') &&
          content.includes('resolve_remote_helper_path() {'),
        `${name} should retain inline bootstrap fallback for hosts missing remote-bootstrap.sh`
      );
    }
  });

  void test('staging remote deploy can resolve its helper library when streamed over SSH', () => {
    const remoteContent = readFileSync(stagingRemotePath, 'utf-8');

    assert.ok(
      remoteContent.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"'),
      'deploy-staging-remote.sh should guard against missing BASH_SOURCE when the payload is streamed over SSH'
    );
    assert.ok(
      remoteContent.includes('APP_DIR="/opt/classroompath/app"'),
      'deploy-staging-remote.sh should declare the canonical app directory explicitly'
    );
    assert.ok(
      remoteContent.includes('SCRIPT_DIR="$APP_DIR/scripts"'),
      'deploy-staging-remote.sh should fall back to the deployed scripts directory when stdin execution has no script path'
    );
    assert.ok(
      remoteContent.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        remoteContent.includes('source "$REMOTE_HELPER_CONTRACTS_PATH"') &&
        remoteContent.includes('release_manifest_helper_supports_contract()') &&
        remoteContent.includes('refresh_deployed_release_helpers()') &&
        remoteContent.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        remoteContent.includes(
          'if ! release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then'
        ) &&
        remoteContent.includes('source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"') &&
        !remoteContent.includes('decode_release_manifest_base64() {') &&
        !remoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-staging-remote.sh should source the shared release-manifest compatibility helper when the deployed checkout is too old to provide the primary helper and reload the refreshed helper contract after checkout'
    );
  });

  void test('production remote scripts can resolve helper libraries when ssh-action omits BASH_SOURCE', () => {
    const deployRemoteContent = readFileSync(productionRemotePath, 'utf-8');
    const rollbackRemoteContent = readFileSync(rollbackRemotePath, 'utf-8');

    for (const [scriptName, content] of [
      ['deploy-production-remote.sh', deployRemoteContent],
      ['rollback-production-remote.sh', rollbackRemoteContent],
    ] as const) {
      assert.ok(
        content.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"'),
        `${scriptName} should guard against missing BASH_SOURCE when appleboy/ssh-action streams the payload`
      );
      assert.ok(
        content.includes('APP_DIR="/opt/classroompath/app"'),
        `${scriptName} should declare the canonical app directory explicitly`
      );
      assert.ok(
        content.includes('SCRIPT_DIR="$APP_DIR/scripts"'),
        `${scriptName} should fall back to the deployed scripts directory when stdin execution has no script path`
      );
      assert.ok(
        content.includes('COMMON_SH_DEPLOYED_PATH="$APP_DIR/scripts/lib/common.sh"'),
        `${scriptName} should keep an absolute path to the deployed helper library after the remote checkout updates the app directory`
      );
      assert.ok(
        content.includes('reload_deployed_common_helpers() {'),
        `${scriptName} should be able to re-source helper functions from the freshly checked out app directory`
      );
    }

    assert.ok(
      deployRemoteContent.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        deployRemoteContent.includes('source "$REMOTE_HELPER_CONTRACTS_PATH"') &&
        deployRemoteContent.includes('release_manifest_helper_supports_contract()') &&
        deployRemoteContent.includes('refresh_deployed_release_helpers()') &&
        deployRemoteContent.includes('RELEASE_MANIFEST_COMPAT_HELPER_PATH') &&
        deployRemoteContent.includes(
          'if ! release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"; then'
        ) &&
        deployRemoteContent.includes('source "$RELEASE_MANIFEST_COMPAT_HELPER_PATH"') &&
        !deployRemoteContent.includes('decode_release_manifest_base64() {') &&
        !deployRemoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-production-remote.sh should source the shared release-manifest compatibility helper when the deployed checkout is too old to provide the primary helper and reload the refreshed helper contract after checkout'
    );
  });

  void test('remote deploy scripts reuse remote-bootstrap helper when available', () => {
    for (const [scriptName, content] of [
      ['deploy-staging-remote.sh', readFileSync(stagingRemotePath, 'utf-8')],
      ['deploy-production-remote.sh', readFileSync(productionRemotePath, 'utf-8')],
      ['rollback-production-remote.sh', readFileSync(rollbackRemotePath, 'utf-8')],
      [
        'persist-staging-verification-remote.sh',
        readFileSync(persistVerificationRemotePath, 'utf-8'),
      ],
    ] as const) {
      assert.ok(
        content.includes('REMOTE_BOOTSTRAP_HELPER_PATH=') &&
          content.includes('resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE"') &&
          content.includes('resolve_remote_helper_path') &&
          (scriptName === 'rollback-production-remote.sh' ||
            content.includes('REMOTE_HELPER_CONTRACTS_PATH')),
        `${scriptName} should reuse the shared remote bootstrap helper when available`
      );
    }
  });

  void test('remote deploy scripts resolve the shared release-state compatibility helper', () => {
    for (const [scriptName, content] of [
      ['deploy-staging-remote.sh', readFileSync(stagingRemotePath, 'utf-8')],
      ['deploy-production-remote.sh', readFileSync(productionRemotePath, 'utf-8')],
      [
        'persist-staging-verification-remote.sh',
        readFileSync(persistVerificationRemotePath, 'utf-8'),
      ],
    ] as const) {
      assert.ok(
        content.includes('RELEASE_STATE_COMPAT_HELPER_PATH') &&
          content.includes('lib/release-state-compat.sh'),
        `${scriptName} should resolve the shared release-state compatibility helper`
      );
    }
  });

  void test('staging and production execute runtime phases through the shared phase runner', () => {
    const remoteBootstrap = readFileSync(remoteBootstrapHelperPath, 'utf-8');

    assert.ok(
      remoteBootstrap.includes('run_remote_deploy_phases()'),
      'remote-bootstrap.sh should own ordered phase execution'
    );

    for (const [scriptName, content, phases] of [
      [
        'deploy-staging-remote.sh',
        readFileSync(stagingRemotePath, 'utf-8'),
        [
          'prepare_staging_checkout',
          'run_staging_runtime_validation',
          'run_staging_email_delivery_preflight',
          'cleanup_staging_disk_if_needed',
          'run_staging_database_migrations',
          'start_staging_runtime',
          'wait_for_staging_runtime_readiness',
        ],
      ],
      [
        'deploy-production-remote.sh',
        readFileSync(productionRemotePath, 'utf-8'),
        [
          'load_production_deploy_payload',
          'prepare_production_checkout',
          'load_production_release_manifest',
          'classify_production_migration_risk',
          'cleanup_production_disk_if_needed',
          'run_production_database_migrations',
          'start_production_runtime',
          'wait_for_production_runtime_readiness',
        ],
      ],
    ] as const) {
      assert.ok(
        content.includes('run_remote_deploy_phases \\') &&
          phases.every(
            (phase) => content.includes(`  ${phase} \\`) || content.includes(`  ${phase}`)
          ),
        `${scriptName} should pass its ordered runtime phases to run_remote_deploy_phases`
      );
    }
  });
});
