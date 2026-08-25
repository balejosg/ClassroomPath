import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  loadWindowsOfflineInstallerConfig,
  resolveWindowsOfflineInstallerArtifactsDir,
  WindowsOfflineInstallerConfigError,
} from '../src/lib/windows-offline-installer-config.js';

const BASE_ENV = {
  CP_OFFLINE_INSTALLER_TEMPLATE_VERSION: '4.1.0',
  CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT: 'a'.repeat(40),
  CP_OFFLINE_INSTALLER_TEMPLATE_SHA256: 'a'.repeat(64),
  CP_OFFLINE_INSTALLER_TEMPLATE_DIR: '/srv/templates',
  CP_OFFLINE_INSTALLER_ARTIFACTS_DIR: '/srv/artifacts',
  OPENPATH_URL: 'https://openpath.example.test',
};

void describe('windows-offline-installer config', () => {
  void test('accepts canonical pins and applies safe ttl defaults', () => {
    const config = loadWindowsOfflineInstallerConfig({ ...BASE_ENV });
    assert.equal(config.tokenTtlHours, 24);
    assert.equal(config.downloadRefTtlMinutes, 10);
    assert.equal(config.downloadRefMaxAttempts, 3);
    assert.equal(config.templateVersion, '4.1.0');
    assert.equal(config.templateCommit, 'a'.repeat(40));
    assert.equal(config.templateSha256, 'a'.repeat(64));
    assert.equal(config.templateDir, '/srv/templates');
    assert.equal(config.artifactsDir, '/srv/artifacts');
  });

  void test('accepts validated overrides', () => {
    const config = loadWindowsOfflineInstallerConfig({
      ...BASE_ENV,
      CP_OFFLINE_INSTALLER_TOKEN_TTL_HOURS: '12',
      CP_OFFLINE_INSTALLER_DOWNLOAD_TTL_MINUTES: '5',
      CP_OFFLINE_INSTALLER_DOWNLOAD_MAX_ATTEMPTS: '2',
      CP_OFFLINE_INSTALLER_TEMPLATE_DIR: '/srv/templates-new',
      CP_OFFLINE_INSTALLER_ARTIFACTS_DIR: '/srv/artifacts-new',
    });
    assert.equal(config.tokenTtlHours, 12);
    assert.equal(config.downloadRefTtlMinutes, 5);
    assert.equal(config.downloadRefMaxAttempts, 2);
    assert.equal(config.templateDir, '/srv/templates-new');
    assert.equal(config.artifactsDir, '/srv/artifacts-new');
  });

  void test('uses legacy cache dir only when both canonical dirs are absent', () => {
    const config = loadWindowsOfflineInstallerConfig({
      ...BASE_ENV,
      CP_OFFLINE_INSTALLER_TEMPLATE_DIR: undefined,
      CP_OFFLINE_INSTALLER_ARTIFACTS_DIR: undefined,
      CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR: '/srv/legacy-cache',
    });

    assert.equal(config.templateDir, '/srv/legacy-cache');
    assert.equal(config.artifactsDir, '/srv/legacy-cache/artifacts');
  });

  void test('gives canonical dirs priority over legacy cache dir', () => {
    const config = loadWindowsOfflineInstallerConfig({
      ...BASE_ENV,
      CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR: '/srv/legacy-cache',
    });

    assert.equal(config.templateDir, '/srv/templates');
    assert.equal(config.artifactsDir, '/srv/artifacts');
  });

  void test('resolves the download route directory with the same canonical priority', () => {
    assert.equal(
      resolveWindowsOfflineInstallerArtifactsDir({
        ...BASE_ENV,
        CP_OFFLINE_INSTALLER_ARTIFACTS_DIR: '/srv/artifacts-route',
        CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR: '/srv/legacy-cache',
      }),
      '/srv/artifacts-route'
    );
    assert.equal(
      resolveWindowsOfflineInstallerArtifactsDir({
        CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR: '/srv/legacy-cache',
      }),
      '/srv/legacy-cache/artifacts'
    );
  });

  void test('fails closed on missing pins or malformed values', () => {
    assert.throws(() => loadWindowsOfflineInstallerConfig({}), WindowsOfflineInstallerConfigError);
    assert.throws(
      () =>
        loadWindowsOfflineInstallerConfig({
          ...BASE_ENV,
          CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT: 'abc123',
        }),
      /full 40-character lowercase commit SHA/
    );
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
          CP_OFFLINE_INSTALLER_TEMPLATE_SHA256: 'A'.repeat(64),
        }),
      /hex SHA-256/
    );
    assert.throws(
      () =>
        loadWindowsOfflineInstallerConfig({
          ...BASE_ENV,
          CP_OFFLINE_INSTALLER_TEMPLATE_VERSION: '../latest',
        }),
      /valid release version/
    );
    assert.throws(
      () =>
        loadWindowsOfflineInstallerConfig({
          ...BASE_ENV,
          CP_OFFLINE_INSTALLER_TEMPLATE_DIR: undefined,
          CP_OFFLINE_INSTALLER_ARTIFACTS_DIR: undefined,
        }),
      /CP_OFFLINE_INSTALLER_TEMPLATE_DIR and CP_OFFLINE_INSTALLER_ARTIFACTS_DIR are required/
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
