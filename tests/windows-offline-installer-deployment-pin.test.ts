import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

describe('Windows offline installer deploy pin propagation', () => {
  test('manifest pin wins over legacy host .env before provisioning', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cp-woi-deploy-pin-'));
    try {
      const appDir = path.join(root, 'app');
      const scriptsDir = path.join(appDir, 'scripts');
      const libDir = path.join(scriptsDir, 'lib');
      const dockerDir = path.join(appDir, 'docker');
      const configDir = path.join(appDir, 'config');
      const manifestPath = path.join(root, 'manifest.env');

      mkdirSync(libDir, { recursive: true });
      mkdirSync(dockerDir, { recursive: true });
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(appDir, '.keep'), 'ok');
      writeFileSync(path.join(scriptsDir, 'provision-windows-offline-installer-template.mjs'), '');
      writeFileSync(
        path.join(libDir, 'windows-offline-installer-template-path.mjs'),
        readFileSync(
          path.join(projectRoot, 'scripts/lib/windows-offline-installer-template-path.mjs'),
          'utf8'
        )
      );
      writeFileSync(
        path.join(configDir, '.env'),
        [
          'CP_OFFLINE_INSTALLER_TEMPLATE_VERSION=old-version',
          `CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT=${'1'.repeat(40)}`,
          'CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG=scripts-v-old',
          `CP_OFFLINE_INSTALLER_TEMPLATE_SHA256=${'1'.repeat(64)}`,
          '',
        ].join('\n')
      );
      writeFileSync(manifestPath, 'manifest-pin-placeholder\n');

      const shell = `
        set -euo pipefail
        source ${JSON.stringify(path.join(projectRoot, 'scripts/lib/common.sh'))}
        source ${JSON.stringify(path.join(projectRoot, 'scripts/lib/deploy-host-preflight.sh'))}
        configure_node_path() { export NODE_BIN=${JSON.stringify(process.execPath)}; }
        load_release_manifest_runtime() {
          export CP_OFFLINE_INSTALLER_TEMPLATE_VERSION=4.1.0
          export CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT=${'2'.repeat(40)}
          export CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG=scripts-v4.1.0-2222222
          export CP_OFFLINE_INSTALLER_TEMPLATE_SHA256=${'2'.repeat(64)}
        }
        APP_DIR=${JSON.stringify(appDir)}
        STAGING_RELEASE_MANIFEST_FILE=${JSON.stringify(manifestPath)}
        provision_windows_offline_installer_template "$APP_DIR"
        printf 'pin=%s,%s,%s,%s\\n' \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_VERSION" \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT" \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG" \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_SHA256"
        printf 'host=%s\\n' "$CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR"
      `;

      const output = execFileSync('bash', ['-lc', shell], {
        cwd: projectRoot,
        encoding: 'utf8',
      });

      assert.match(
        output,
        /pin=4\.1\.0,2222222222222222222222222222222222222222,scripts-v4\.1\.0-2222222,2222222222222222222222222222222222222222222222222222222222222222/
      );
      assert.doesNotMatch(output, /old-version|scripts-v-old/);
      assert.ok(
        output.includes(path.join(appDir, 'var/windows-offline-installer/templates')),
        `legacy host must use the Compose-relative default; output=${output}`
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('production reloads the manifest even when legacy host pin is complete', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cp-woi-production-pin-'));
    const manifestPath = path.join(root, 'manifest.env');
    writeFileSync(manifestPath, 'manifest-pin-placeholder\n');

    try {
      const shell = `
        set -euo pipefail
        source ${JSON.stringify(path.join(projectRoot, 'scripts/lib/common.sh'))}
        source ${JSON.stringify(path.join(projectRoot, 'scripts/lib/release-runtime.sh'))}
        source ${JSON.stringify(path.join(projectRoot, 'scripts/lib/deploy-production-runtime.sh'))}
        load_release_manifest_runtime() {
          export CP_OFFLINE_INSTALLER_TEMPLATE_VERSION=4.1.0
          export CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT=${'3'.repeat(40)}
          export CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG=scripts-v4.1.0-3333333
          export CP_OFFLINE_INSTALLER_TEMPLATE_SHA256=${'3'.repeat(64)}
        }
        PRODUCTION_DEPLOY_PLAN=release-candidate
        RELEASE_MANIFEST_FILE=${JSON.stringify(manifestPath)}
        OPENPATH_FIREFOX_ASSETS_IMAGE=firefox-assets
        OPENPATH_VERSION=4.1.0
        OPENPATH_LINUX_AGENT_VERSION=4.1.0
        OPENPATH_LINUX_AGENT_APT_SUITE=bookworm
        CP_OFFLINE_INSTALLER_TEMPLATE_VERSION=old-version
        CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT=${'1'.repeat(40)}
        CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG=scripts-v-old
        CP_OFFLINE_INSTALLER_TEMPLATE_SHA256=${'1'.repeat(64)}
        ensure_production_release_candidate_runtime_env
        printf 'pin=%s,%s,%s,%s\\n' \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_VERSION" \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT" \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG" \\
          "$CP_OFFLINE_INSTALLER_TEMPLATE_SHA256"
      `;

      const output = execFileSync('bash', ['-lc', shell], {
        cwd: projectRoot,
        encoding: 'utf8',
      });

      assert.match(
        output,
        /pin=4\.1\.0,3333333333333333333333333333333333333333,scripts-v4\.1\.0-3333333,3333333333333333333333333333333333333333333333333333333333333333/
      );
      assert.doesNotMatch(output, /old-version|scripts-v-old/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
