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

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

void describe('Remote Deploy Bootstrap', () => {
  const remoteBootstrapHelperPath = resolve(projectRoot, 'scripts/lib/remote-bootstrap.sh');
  const stagingRemotePath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const productionRemotePath = resolve(projectRoot, 'scripts/deploy-production-remote.sh');
  const rollbackRemotePath = resolve(projectRoot, 'scripts/rollback-production-remote.sh');
  const persistVerificationRemotePath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );

  void test('remote bootstrap helper owns script-dir and helper-path resolution', () => {
    const content = readFileSync(remoteBootstrapHelperPath, 'utf-8');

    assert.ok(
      existsSync(remoteBootstrapHelperPath),
      'scripts/lib/remote-bootstrap.sh should exist'
    );
    assert.ok(
      content.includes('resolve_remote_script_dir()') &&
        content.includes('resolve_remote_helper_path()') &&
        content.includes('reload_deployed_common_helpers()'),
      'remote-bootstrap.sh should own shared remote helper resolution functions'
    );
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
      remoteContent.includes('if [ ! -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then') &&
        remoteContent.includes('decode_release_manifest_base64() {') &&
        remoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-staging-remote.sh should inline release-manifest helpers when the deployed checkout is too old to provide them'
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
      deployRemoteContent.includes('if [ ! -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then') &&
        deployRemoteContent.includes('decode_release_manifest_base64() {') &&
        deployRemoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-production-remote.sh should inline release-manifest helpers when the deployed checkout is too old to provide them'
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
          content.includes('resolve_remote_helper_path'),
        `${scriptName} should reuse the shared remote bootstrap helper when available`
      );
    }
  });
});
