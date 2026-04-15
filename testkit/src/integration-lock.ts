import { open as openFile, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_INTEGRATION_SUITE_LOCK_PATH = join(
  tmpdir(),
  'classroompath-api-integration.lock'
);

export async function acquireIntegrationSuiteLock(
  lockPath = DEFAULT_INTEGRATION_SUITE_LOCK_PATH
): Promise<FileHandle> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await openFile(lockPath, 'wx');
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }

      await sleep(50);
    }
  }

  throw new Error('Timed out waiting for the integration suite database lock');
}

export async function releaseIntegrationSuiteLock(
  handle: FileHandle | undefined,
  lockPath = DEFAULT_INTEGRATION_SUITE_LOCK_PATH
): Promise<void> {
  await handle?.close();
  await unlink(lockPath).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  });
}
