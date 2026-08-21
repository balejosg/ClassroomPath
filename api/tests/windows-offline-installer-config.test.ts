import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  loadWindowsOfflineInstallerConfig,
  WindowsOfflineInstallerConfigError,
} from '../src/lib/windows-offline-installer-config.js';

const BASE_ENV = {
  CP_OFFLINE_INSTALLER_TEMPLATE_VERSION: '4.1.0',
  CP_OFFLINE_INSTALLER_TEMPLATE_SHA256: 'a'.repeat(64),
  OPENPATH_URL: 'https://openpath.example.test',
};

void describe('windows-offline-installer config', () => {
  void test('applies safe defaults for ttl, attempts, and cache dir', () => {
    const config = loadWindowsOfflineInstallerConfig({ ...BASE_ENV });
    assert.equal(config.tokenTtlHours, 24);
    assert.equal(config.downloadRefTtlMinutes, 10);
    assert.equal(config.downloadRefMaxAttempts, 3);
    assert.ok(config.templateCacheDir.endsWith('var/windows-offline-installer'));
  });

  void test('accepts validated overrides', () => {
    const config = loadWindowsOfflineInstallerConfig({
      ...BASE_ENV,
      CP_OFFLINE_INSTALLER_TOKEN_TTL_HOURS: '12',
      CP_OFFLINE_INSTALLER_DOWNLOAD_TTL_MINUTES: '5',
      CP_OFFLINE_INSTALLER_DOWNLOAD_MAX_ATTEMPTS: '2',
      CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR: '/srv/cache',
    });
    assert.equal(config.tokenTtlHours, 12);
    assert.equal(config.downloadRefTtlMinutes, 5);
    assert.equal(config.downloadRefMaxAttempts, 2);
    assert.equal(config.templateCacheDir, '/srv/cache');
  });

  void test('fails closed on missing pins or malformed values', () => {
    assert.throws(() => loadWindowsOfflineInstallerConfig({}), WindowsOfflineInstallerConfigError);
    assert.throws(
      () =>
        loadWindowsOfflineInstallerConfig({
          ...BASE_ENV,
          CP_OFFLINE_INSTALLER_TEMPLATE_SHA256: 'zz',
        }),
      /hex SHA-256/
    );
    assert.throws(
      () =>
        loadWindowsOfflineInstallerConfig({
          ...BASE_ENV,
          CP_OFFLINE_INSTALLER_TOKEN_TTL_HOURS: '-3',
        }),
      /positive integer/
    );
    assert.throws(
      () => loadWindowsOfflineInstallerConfig({ ...BASE_ENV, OPENPATH_URL: '' }),
      WindowsOfflineInstallerConfigError
    );
  });
});
