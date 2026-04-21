import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  quitDriverQuietly,
  waitForExtensionUuid,
} from '../scripts/linux-firefox-block-page-canary.mjs';

test('quitDriverQuietly preserves a successful blocked-page result when Marionette fails during teardown', async () => {
  const evidence = { status: 'success' };
  const warnings = [];
  const driver = {
    async quit() {
      throw new Error('Failed to decode response from marionette');
    },
  };

  await assert.doesNotReject(() =>
    quitDriverQuietly(driver, evidence, {
      warn(message) {
        warnings.push(message);
      },
    })
  );

  assert.match(evidence.cleanupError, /Failed to decode response from marionette/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Failed to decode response from marionette/);
});

test('waitForExtensionUuid resolves UUID from extensions.json rootURI when prefs.js omits it', async () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'classroompath-firefox-profile-'));
  const extensionId = 'monitor-bloqueos@openpath';

  writeFileSync(
    join(profileDir, 'prefs.js'),
    'user_pref("extensions.webextensions.uuids", "{\\"other@example.com\\":\\"other-uuid\\"}");\n',
    'utf8'
  );
  writeFileSync(
    join(profileDir, 'extensions.json'),
    JSON.stringify({
      addons: [
        {
          id: extensionId,
          rootURI: 'moz-extension://resolved-from-extensions-json/',
        },
      ],
    }),
    'utf8'
  );

  const extensionUuid = await waitForExtensionUuid(profileDir, extensionId, 100);

  assert.equal(extensionUuid, 'resolved-from-extensions-json');
});

test('waitForExtensionUuid reports profile diagnostics when UUID stays missing', async () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'classroompath-firefox-profile-'));
  const extensionId = 'monitor-bloqueos@openpath';

  writeFileSync(
    join(profileDir, 'prefs.js'),
    'user_pref("extensions.webextensions.uuids", "{\\"other@example.com\\":\\"other-uuid\\"}");\n',
    'utf8'
  );
  writeFileSync(
    join(profileDir, 'extensions.json'),
    JSON.stringify({ addons: [{ id: extensionId }] }),
    'utf8'
  );

  await assert.rejects(() => waitForExtensionUuid(profileDir, extensionId, 50), {
    message:
      /prefs\.js=uuids:\[other@example\.com\]; extensions\.json=addons:\[monitor-bloqueos@openpath\]; addonStartup\.json\.lz4=missing/,
  });
});
