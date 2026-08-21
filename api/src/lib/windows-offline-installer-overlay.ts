import { createHash } from 'node:crypto';
import { open, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import {
  WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC,
  WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE,
  WINDOWS_OFFLINE_INSTALLER_FLAGS,
  WINDOWS_OFFLINE_INSTALLER_HEADER_MAGIC,
  WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE,
  WINDOWS_OFFLINE_INSTALLER_SCHEMA_VERSION,
  WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH,
  type WindowsOfflineInstallerConfig,
} from '@openpath/shared/windows-offline-installer';

export class WindowsOfflineOverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindowsOfflineOverlayError';
  }
}

function uint16le(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function uint32le(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

async function readExactly(
  handle: import('node:fs/promises').FileHandle,
  buffer: Buffer,
  offsetBytes: number
): Promise<void> {
  await handle.read(buffer, 0, buffer.length, offsetBytes).then((result) => {
    if (result.bytesRead !== buffer.length) {
      throw new WindowsOfflineOverlayError('Short read while parsing the template trailer');
    }
  });
}

/**
 * Copies the template byte-for-byte and replaces only the fixed payload slot,
 * updating the header hash/length fields and the epilogue slot-length copy.
 * The output keeps the exact template size and is published with an atomic
 * same-directory rename.
 */
export async function applyWindowsOfflineOverlay(
  templatePath: string,
  outputPath: string,
  config: WindowsOfflineInstallerConfig
): Promise<void> {
  const payloadText = JSON.stringify(config);
  const payload = Buffer.from(payloadText, 'utf8');
  if (payload.length > WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH) {
    throw new WindowsOfflineOverlayError(
      'Offline configuration exceeds the fixed installer slot size'
    );
  }

  const handle = await open(templatePath, 'r');
  let baseBuffer: Buffer;
  try {
    const { size } = await handle.stat();
    const minimumSize =
      WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE +
      WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH +
      WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE;
    if (size < minimumSize) {
      throw new WindowsOfflineOverlayError('Template is too small to carry an offline trailer');
    }

    const epilogueOffset = size - WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE;
    const epilogue = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE);
    await readExactly(handle, epilogue, epilogueOffset);

    const epilogueMagic = epilogue.toString('latin1', 0, 4);
    if (epilogueMagic !== WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC) {
      throw new WindowsOfflineOverlayError('Template lacks the offline trailer epilogue');
    }

    const slotLength = epilogue.readUInt32LE(4);
    const headerSize = epilogue.readUInt32LE(8);
    const epilogueSize = epilogue.readUInt32LE(12);

    if (
      slotLength !== WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH ||
      headerSize !== WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE ||
      epilogueSize !== WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE
    ) {
      throw new WindowsOfflineOverlayError('Unsupported trailer geometry in the template');
    }

    baseBuffer = Buffer.alloc(size - minimumSize);
    await readExactly(handle, baseBuffer, 0);
  } finally {
    await handle.close();
  }

  const payloadSha256 = createHash('sha256').update(payload).digest();

  const header = Buffer.concat([
    Buffer.from(WINDOWS_OFFLINE_INSTALLER_HEADER_MAGIC, 'latin1'),
    uint16le(WINDOWS_OFFLINE_INSTALLER_SCHEMA_VERSION),
    uint16le(WINDOWS_OFFLINE_INSTALLER_FLAGS),
    uint32le(payload.length),
    uint32le(WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH),
    payloadSha256,
  ]);

  const slot = Buffer.alloc(WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH, 0);
  payload.copy(slot, 0);

  const epilogue = Buffer.concat([
    Buffer.from(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_MAGIC, 'latin1'),
    uint32le(WINDOWS_OFFLINE_INSTALLER_SLOT_LENGTH),
    uint32le(WINDOWS_OFFLINE_INSTALLER_HEADER_SIZE),
    uint32le(WINDOWS_OFFLINE_INSTALLER_EPILOGUE_SIZE),
  ]);

  const stagedPath = `${outputPath}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await (
      await import('node:fs/promises')
    ).writeFile(stagedPath, Buffer.concat([baseBuffer, header, slot, epilogue]));
    await rename(stagedPath, outputPath);
  } catch (error) {
    await (await import('node:fs/promises')).rm(stagedPath, { force: true }).catch(() => undefined);
    throw error instanceof WindowsOfflineOverlayError
      ? error
      : new WindowsOfflineOverlayError(error instanceof Error ? error.message : 'Overlay failed');
  }
}
