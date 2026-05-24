/**
 * Remote Deploy Bootstrap Tests
 *
 * Contracts for streamed staging/production deploy scripts that now require the
 * checked-out helper files on the target host to meet the current contract.
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
  const remoteDeployScaffoldHelperPath = resolve(
    projectRoot,
    'scripts/lib/remote-deploy-scaffold.sh'
  );
  const remoteHelperContractsPath = resolve(projectRoot, 'scripts/lib/remote-helper-contracts.sh');
  const releaseManifestHelperPath = resolve(projectRoot, 'scripts/lib/release-manifest.sh');
  const deployPayloadHelperPath = resolve(projectRoot, 'scripts/lib/deploy-payload.sh');
  const stagingRemotePath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const productionRemotePath = resolve(projectRoot, 'scripts/deploy-production-remote.sh');
  const rollbackRemotePath = resolve(projectRoot, 'scripts/rollback-production-remote.sh');
  const persistVerificationRemotePath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );
  const persistWindowsBootstrapCanaryPath = resolve(
    projectRoot,
    'scripts/persist-staging-windows-bootstrap-canary.sh'
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

  void test('shared release manifest helper owns the remote manifest contract', () => {
    const releaseManifestHelper = readFileSync(releaseManifestHelperPath, 'utf-8');

    for (const functionName of [
      'release_manifest_get',
      'release_manifest_require_key',
      'decode_release_manifest_base64',
      'release_manifest_validate_contract',
      'export_release_manifest_runtime_env',
    ] as const) {
      assert.ok(
        extractShellFunction(releaseManifestHelper, functionName).length > 0,
        `release-manifest.sh should define ${functionName}()`
      );
    }
  });

  void test('staging and production resolve release-runtime through the shared bootstrap helper', () => {
    const scaffoldContent = readFileSync(
      resolve(projectRoot, 'scripts/lib/remote-deploy-scaffold.sh'),
      'utf-8'
    );

    assert.ok(
      scaffoldContent.includes(
        'RELEASE_RUNTIME_HELPER_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/release-runtime.sh")"'
      ),
      'remote-deploy-scaffold.sh should own release-runtime helper resolution'
    );

    for (const relativePath of [
      'scripts/deploy-staging-remote.sh',
      'scripts/deploy-production-remote.sh',
    ]) {
      const content = readFileSync(resolve(projectRoot, relativePath), 'utf-8');

      assert.ok(
        content.includes('remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"'),
        `${relativePath} should initialize release-runtime helper resolution through the shared scaffold`
      );
      assert.ok(
        !content.includes('RELEASE_RUNTIME_HELPER_PATH="$SCRIPT_DIR/lib/release-runtime.sh"'),
        `${relativePath} should not duplicate release-runtime.sh path selection inline`
      );
    }
  });

  void test('staging and production require the shared bootstrap helper instead of keeping inline fallback bodies', () => {
    const stagingRemote = readFileSync(stagingRemotePath, 'utf-8');
    const productionRemote = readFileSync(productionRemotePath, 'utf-8');

    for (const [name, content] of [
      ['deploy-staging-remote.sh', stagingRemote],
      ['deploy-production-remote.sh', productionRemote],
    ] as const) {
      assert.ok(
        content.includes('source "$REMOTE_BOOTSTRAP_HELPER_PATH"') &&
          !content.includes('resolve_remote_script_dir() {') &&
          !content.includes('resolve_remote_helper_path() {') &&
          !content.includes('reload_deployed_common_helpers() {') &&
          !content.includes('run_remote_deploy_phases() {'),
        `${name} should require the shared remote bootstrap helper instead of carrying inline fallback bodies`
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
      remoteContent.includes('APP_DIR="/srv/classroompath/app"'),
      'deploy-staging-remote.sh should declare the canonical staging app directory explicitly'
    );
    assert.ok(
      remoteContent.includes('SCRIPT_DIR="$APP_DIR/scripts"'),
      'deploy-staging-remote.sh should fall back to the deployed scripts directory when stdin execution has no script path'
    );
    assert.ok(
      remoteContent.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        remoteContent.includes('source "$REMOTE_HELPER_CONTRACTS_PATH"') &&
        remoteContent.includes(
          'release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"'
        ) &&
        remoteContent.includes(
          'remote_deploy_reload_checked_out_helpers "$APP_DIR/scripts/lib/common.sh"'
        ) &&
        remoteContent.includes('source "$RELEASE_MANIFEST_HELPER_PATH"') &&
        !remoteContent.includes('decode_release_manifest_base64() {') &&
        !remoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-staging-remote.sh should source shared helper contracts and manifest helpers without duplicating inline fallback bodies'
    );
    assert.ok(
      !remoteContent.includes('write_release_state_snapshot() {') &&
        !remoteContent.includes('load_release_manifest_runtime() {'),
      'deploy-staging-remote.sh should not inline release-state or release-runtime fallback bodies once the remote contract floor is raised'
    );
  });

  void test('production remote scripts can resolve helper libraries when ssh-action omits BASH_SOURCE', () => {
    const deployRemoteContent = readFileSync(productionRemotePath, 'utf-8');
    const rollbackRemoteContent = readFileSync(rollbackRemotePath, 'utf-8');
    const commonHelperContent = readFileSync(
      resolve(projectRoot, 'scripts/lib/common.sh'),
      'utf-8'
    );
    const syncBillingEnvContent = readFileSync(
      resolve(projectRoot, 'scripts/sync-billing-env.sh'),
      'utf-8'
    );

    for (const [scriptName, content] of [
      ['deploy-production-remote.sh', deployRemoteContent],
      ['rollback-production-remote.sh', rollbackRemoteContent],
    ] as const) {
      assert.ok(
        content.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"'),
        `${scriptName} should guard against missing BASH_SOURCE when appleboy/ssh-action streams the payload`
      );
      assert.ok(
        content.includes('default_classroompath_deploy_root()') &&
          content.includes(
            'CLASSROOMPATH_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-$(default_classroompath_deploy_root)}"'
          ) &&
          content.includes('APP_DIR="${APP_DIR:-$CLASSROOMPATH_DEPLOY_ROOT/app}"'),
        `${scriptName} should resolve the production app directory from the deploy root`
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
        content.includes('remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"'),
        `${scriptName} should re-source helper functions from the freshly checked out app directory`
      );
    }

    assert.ok(
      commonHelperContent.includes('configure_node_path()') &&
        commonHelperContent.includes('node_bin="$(resolve_node_bin)"') &&
        commonHelperContent.includes('export NODE_BIN="$node_bin"') &&
        commonHelperContent.includes('export PATH="$node_dir:$PATH"'),
      'common.sh should publish a shared node PATH bootstrap for non-login SSH shells'
    );
    assert.ok(
      !deployRemoteContent.includes(
        'configure_node_path\n\nif release_manifest_helper_supports_contract'
      ) &&
        deployRemoteContent.includes('release_risk_policy_classify_migration_risk_without_node') &&
        deployRemoteContent.includes('if command -v node >/dev/null 2>&1; then') &&
        deployRemoteContent.includes(
          'release_execution_classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"'
        ),
      'deploy-production-remote.sh should not require host node before checkout and should classify migrations with a shell fallback'
    );
    assert.ok(
      syncBillingEnvContent.includes(
        'NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"'
      ) &&
        syncBillingEnvContent.includes('if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then') &&
        syncBillingEnvContent.includes('"$NODE_BIN" "$RUNTIME_ENV_POLICY_SCRIPT" "$1"') &&
        syncBillingEnvContent.includes('Unsupported runtime policy command without node'),
      'sync-billing-env.sh should use node when present and a shell policy fallback on production hosts without node'
    );

    assert.ok(
      deployRemoteContent.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        deployRemoteContent.includes('source "$REMOTE_HELPER_CONTRACTS_PATH"') &&
        deployRemoteContent.includes(
          'release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"'
        ) &&
        deployRemoteContent.includes(
          'remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"'
        ) &&
        deployRemoteContent.includes('source "$RELEASE_MANIFEST_HELPER_PATH"') &&
        !deployRemoteContent.includes('decode_release_manifest_base64() {') &&
        !deployRemoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-production-remote.sh should source shared helper contracts and manifest helpers without duplicating inline fallback bodies'
    );
    assert.ok(
      !deployRemoteContent.includes('write_release_state_snapshot() {') &&
        !deployRemoteContent.includes('load_release_manifest_runtime() {') &&
        !deployRemoteContent.includes('deployment_state_init_paths() {'),
      'deploy-production-remote.sh should not inline release-state, release-runtime, or deployment-state fallback bodies once the remote contract floor is raised'
    );
    assert.ok(
      rollbackRemoteContent.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        rollbackRemoteContent.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        rollbackRemoteContent.includes(
          'deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"'
        ) &&
        !rollbackRemoteContent.includes('resolve_remote_script_dir() {') &&
        !rollbackRemoteContent.includes('resolve_remote_helper_path() {') &&
        !rollbackRemoteContent.includes('reload_deployed_common_helpers() {') &&
        !rollbackRemoteContent.includes('deployment_state_init_paths() {') &&
        !rollbackRemoteContent.includes('upsert_env_file_var() {'),
      'rollback-production-remote.sh should require the shared scaffold and versioned helper contracts without inline fallback bodies'
    );
  });

  void test('production remote deploy writes sanitized failure debug context', () => {
    const deployRemoteContent = readFileSync(productionRemotePath, 'utf-8');

    assert.ok(
      deployRemoteContent.includes('DEPLOY_DEBUG_FILE="$STATE_DIR/deploy-debug.json"') &&
        deployRemoteContent.includes('write_production_deploy_debug_context()') &&
        deployRemoteContent.includes('install -m 600 "$tmp_file" "$DEPLOY_DEBUG_FILE"') &&
        deployRemoteContent.includes('capture_production_deploy_failure()') &&
        deployRemoteContent.includes('trap capture_production_deploy_failure ERR'),
      'production deploy failures should persist a restricted debug JSON file'
    );
    assert.ok(
      deployRemoteContent.includes('"deployStage"') &&
        deployRemoteContent.includes('"targetSha"') &&
        deployRemoteContent.includes('"deployRoot"') &&
        deployRemoteContent.includes('"containerPlatform"') &&
        deployRemoteContent.includes('"helperContracts"') &&
        deployRemoteContent.includes('"commands"') &&
        deployRemoteContent.includes('"lastFailingPhase"'),
      'debug JSON should include the requested sanitized failure context'
    );
    assert.ok(
      deployRemoteContent.includes('command_status_json bash') &&
        deployRemoteContent.includes('command_status_json git') &&
        deployRemoteContent.includes('command_status_json docker') &&
        deployRemoteContent.includes('command_status_json node'),
      'debug JSON should record command availability without secrets'
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

  void test('streamed remote deploys recover helper paths locally when the host scaffold is older', () => {
    for (const [scriptName, content, expectedHelpers] of [
      [
        'deploy-staging-remote.sh',
        readFileSync(stagingRemotePath, 'utf-8'),
        [
          'COMMON_SH_PATH',
          'DEPLOY_HOST_PREFLIGHT_HELPER_PATH',
          'RELEASE_MANIFEST_HELPER_PATH',
          'DEPLOY_PAYLOAD_HELPER_PATH',
          'RELEASE_STATE_HELPER_PATH',
          'RELEASE_RUNTIME_HELPER_PATH',
          'REMOTE_HELPER_CONTRACTS_PATH',
        ],
      ],
      [
        'deploy-production-remote.sh',
        readFileSync(productionRemotePath, 'utf-8'),
        [
          'COMMON_SH_PATH',
          'DEPLOY_HOST_PREFLIGHT_HELPER_PATH',
          'RELEASE_MANIFEST_HELPER_PATH',
          'DEPLOY_PAYLOAD_HELPER_PATH',
          'RELEASE_STATE_HELPER_PATH',
          'RELEASE_RUNTIME_HELPER_PATH',
          'REMOTE_HELPER_CONTRACTS_PATH',
          'DEPLOYMENT_STATE_HELPER_PATH',
          'DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH',
          'DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH',
        ],
      ],
    ] as const) {
      for (const helperName of expectedHelpers) {
        assert.ok(
          content.includes(
            `: "\${${helperName}:=$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR"`
          ),
          `${scriptName} should recover ${helperName} directly when an older remote scaffold leaves it unset`
        );
      }
    }
  });

  void test('remote deploys load the host preflight helper only after checkout refreshes the repo', () => {
    for (const [scriptName, content, reloadCall] of [
      [
        'deploy-staging-remote.sh',
        readFileSync(stagingRemotePath, 'utf-8'),
        'remote_deploy_reload_checked_out_helpers "$APP_DIR/scripts/lib/common.sh"',
      ],
      [
        'deploy-production-remote.sh',
        readFileSync(productionRemotePath, 'utf-8'),
        'remote_deploy_reload_checked_out_helpers "$COMMON_SH_DEPLOYED_PATH"',
      ],
    ] as const) {
      assert.ok(
        content.includes('load_deploy_host_preflight_helper() {') &&
          content.includes('Deploy host preflight helper not found after checkout') &&
          content.includes(reloadCall) &&
          content.includes('load_deploy_host_preflight_helper'),
        `${scriptName} should delay preflight helper loading until after the checkout refreshes the remote repo`
      );
    }
  });

  void test('remote deploy reload refreshes bootstrap helpers after checkout', () => {
    const remoteDeployScaffold = readFileSync(remoteDeployScaffoldHelperPath, 'utf-8');

    assert.ok(
      remoteDeployScaffold.includes('REMOTE_BOOTSTRAP_HELPER_PATH=') &&
        remoteDeployScaffold.includes('source "$REMOTE_BOOTSTRAP_HELPER_PATH"'),
      'remote-deploy-scaffold.sh should reload remote-bootstrap.sh after checkout so newly introduced phase helpers are available'
    );
  });

  void test('remote deploy scripts resolve the shared release-state helper', () => {
    for (const [scriptName, content] of [
      ['deploy-staging-remote.sh', readFileSync(stagingRemotePath, 'utf-8')],
      ['deploy-production-remote.sh', readFileSync(productionRemotePath, 'utf-8')],
      [
        'persist-staging-verification-remote.sh',
        readFileSync(persistVerificationRemotePath, 'utf-8'),
      ],
    ] as const) {
      assert.ok(
        content.includes('RELEASE_STATE_HELPER_PATH') && content.includes('lib/release-state.sh'),
        `${scriptName} should resolve the shared release-state helper`
      );
    }
  });

  void test('staging verification persistence requires versioned shared helpers instead of inline fallback writers', () => {
    const content = readFileSync(persistVerificationRemotePath, 'utf-8');

    assert.ok(
      content.includes('source "$REMOTE_BOOTSTRAP_HELPER_PATH"') &&
        content.includes('source "$REMOTE_HELPER_CONTRACTS_PATH"') &&
        !content.includes('resolve_remote_script_dir() {') &&
        !content.includes('resolve_remote_helper_path() {') &&
        !content.includes('write_release_state_snapshot() {') &&
        !content.includes('write_staging_verification_state() {'),
      'persist-staging-verification-remote.sh should require versioned shared helpers instead of carrying inline bootstrap and release-state fallback bodies'
    );
  });

  void test('Windows bootstrap canary persistence overrides loaded staging state with fresh workflow evidence', () => {
    const content = readFileSync(persistWindowsBootstrapCanaryPath, 'utf-8');
    const sourceStateIndex = content.indexOf('source "$state_file"');
    const canaryOverrideIndex = content.indexOf(
      'STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT="$INPUT_STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT"'
    );
    const writeStateIndex = content.indexOf('write_staging_verification_state "$state_file"');

    assert.ok(sourceStateIndex > 0, 'persist script should load the existing staging state first');
    assert.ok(
      canaryOverrideIndex > sourceStateIndex,
      'fresh workflow canary evidence should override stale values loaded from the state file'
    );
    assert.ok(
      writeStateIndex > canaryOverrideIndex,
      'persist script should write the merged staging state after applying fresh canary evidence'
    );
  });

  void test('staging and production execute runtime phases through the shared phase runner', () => {
    const remoteBootstrap = readFileSync(remoteBootstrapHelperPath, 'utf-8');

    assert.ok(
      remoteBootstrap.includes('run_remote_deploy_phases()') &&
        remoteBootstrap.includes('run_remote_deploy_phase_group()'),
      'remote-bootstrap.sh should own ordered and parallel-safe phase execution'
    );

    for (const [scriptName, content, phases] of [
      [
        'deploy-staging-remote.sh',
        readFileSync(stagingRemotePath, 'utf-8'),
        [
          'prepare_staging_checkout',
          'run_staging_preflight_checks',
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
