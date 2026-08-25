import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import path from 'node:path';

import {
  DEFAULT_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR,
  resolveWindowsOfflineInstallerTemplateDestination,
} from '../scripts/lib/windows-offline-installer-template-path.mjs';

describe('Windows offline installer deployment storage contract', () => {
  test('legacy host without HOST_DIR resolves the same Compose-relative default', () => {
    const composeCwd = '/srv/classroompath/app/docker';
    assert.equal(
      DEFAULT_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR,
      '../var/windows-offline-installer/templates'
    );
    assert.equal(
      resolveWindowsOfflineInstallerTemplateDestination({}, composeCwd),
      path.resolve(composeCwd, DEFAULT_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR)
    );
  });

  test('explicit host override wins over the default', () => {
    const composeCwd = '/srv/classroompath/app/docker';
    assert.equal(
      resolveWindowsOfflineInstallerTemplateDestination(
        { CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR: '/mnt/classroompath/templates' },
        composeCwd
      ),
      '/mnt/classroompath/templates'
    );
  });

  test('runtime template-dir compatibility does not diverge from provisioning resolution', () => {
    const composeCwd = '/srv/classroompath/app/docker';
    assert.equal(
      resolveWindowsOfflineInstallerTemplateDestination(
        { CP_OFFLINE_INSTALLER_TEMPLATE_DIR: '../var/windows-offline-installer/templates' },
        composeCwd
      ),
      path.resolve(composeCwd, DEFAULT_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR)
    );
  });
});
