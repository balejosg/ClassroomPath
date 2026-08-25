import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import {
  WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC,
  WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE,
  WINDOWS_OFFLINE_INSTALLER_HEADER_MAGIC,
  WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE,
  WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH,
  type WindowsOfflineInstallerConfig,
} from '@openpath/shared/windows-offline-installer';

import {
  applyWindowsOfflineOverlay,
  WindowsOfflineOverlayError,
} from '../src/lib/windows-offline-installer-overlay.js';

const CONFIG: WindowsOfflineInstallerConfig = {
  tokenTtlHours: 24,
  downloadRefTtlMinutes: 10,
  downloadRefMaxAttempts: 3,
  templateVersion: '4.1.0',
  templateCommit: 'a'.repeat(40),
  templateSha256: 'a'.repeat(64),
  templateDir: '/tmp/templates',
  artifactsDir: '/tmp/artifacts',
  openpathUrl: 'https://openpath.example.test',
};

const tempRoot = await mkdtemp(path.join(tmpdir(), 'cp-offline-overlay-'));

async function buildTemplate(
  name: string,
  epilogueMagic = WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC
): Promise<string> {
  const templatePath = path.join(tempRoot, name);
  const base = Buffer.from('NSIS-PAYLOAD-SIMULATION', 'utf8');
  const slot = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH);
  const header = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE);
  Buffer.from(WINDOWS_OFFLINE_INSTALLER_HEADER_MAGIC, 'latin1').copy(header, 0);
  const epilogue = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE);
  Buffer.from(epilogueMagic, 'latin1').copy(epilogue, 0);
  epilogue.writeUInt32LE(WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH, 4);
  epilogue.writeUInt32LE(WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE, 8);
  epilogue.writeUInt32LE(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE, 12);
  await writeFile(templatePath, Buffer.concat([base, header, slot, epilogue]));
  return templatePath;
}

void describe('windows-offline-installer overlay', () => {
  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  void test('rejects a template that is too small to carry a trailer', async () => {
    const tinyPath = path.join(tempRoot, 'tiny.bin');
    await writeFile(tinyPath, Buffer.alloc(32));
    await assert.rejects(
      applyWindowsOfflineOverlay(tinyPath, path.join(tempRoot, 'tiny-out.bin'), CONFIG),
      WindowsOfflineOverlayError
    );
  });

  void test('rejects a template without the trailer epilogue magic', async () => {
    const badTemplate = await buildTemplate('bad-magic.bin', 'NOPE');
    await assert.rejects(
      applyWindowsOfflineOverlay(badTemplate, path.join(tempRoot, 'bad-out.bin'), CONFIG),
      /epilogue/
    );
  });

  void test('rejects unsupported trailer geometry', async () => {
    const templatePath = path.join(tempRoot, 'bad-geometry.bin');
    const base = Buffer.alloc(8);
    const slot = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH);
    const header = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE);
    const epilogue = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE);
    Buffer.from(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC, 'latin1').copy(epilogue, 0);
    epilogue.writeUInt32LE(1234, 4);
    epilogue.writeUInt32LE(WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE, 8);
    epilogue.writeUInt32LE(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE, 12);
    await writeFile(templatePath, Buffer.concat([base, header, slot, epilogue]));
    await assert.rejects(
      applyWindowsOfflineOverlay(templatePath, path.join(tempRoot, 'geometry-out.bin'), CONFIG),
      /geometry/
    );
  });

  void test('produces same-size output with embedded config and intact payload', async () => {
    const templatePath = await buildTemplate('good.bin');
    const outputPath = path.join(tempRoot, 'good-out.bin');
    await applyWindowsOfflineOverlay(templatePath, outputPath, CONFIG);

    const template = await readFile(templatePath);
    const output = await readFile(outputPath);
    assert.equal(output.length, template.length);

    const outputText = output.toString('latin1');
    assert.ok(outputText.includes(JSON.stringify(CONFIG)));
    assert.ok(outputText.startsWith('NSIS-PAYLOAD-SIMULATION'));
    const headerMagic = Buffer.from(WINDOWS_OFFLINE_INSTALLER_HEADER_MAGIC, 'latin1');
    const headerOffset = output.indexOf(headerMagic);
    assert.ok(headerOffset > 0);
    assert.equal(output.subarray(0, headerOffset).toString('latin1'), 'NSIS-PAYLOAD-SIMULATION');
    const epilogueOffset = output.length - WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE;
    assert.equal(
      output.toString('latin1', epilogueOffset, epilogueOffset + 4),
      WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC
    );
  });
});
