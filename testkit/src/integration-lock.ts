import { open as openFile, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_INTEGRATION_SUITE_LOCK_TIMEOUT_MS = 120_000;
const INTEGRATION_SUITE_LOCK_POLL_MS = 50;

export const DEFAULT_INTEGRATION_SUITE_LOCK_PATH = join(
  tmpdir(),
  'classroompath-api-integration.lock'
);

function resolveIntegrationSuiteLockTimeoutMs(): number {
  const rawValue = process.env.CLASSROOMPATH_INTEGRATION_LOCK_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_INTEGRATION_SUITE_LOCK_TIMEOUT_MS;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_INTEGRATION_SUITE_LOCK_TIMEOUT_MS;
  }

  return parsedValue;
}

export async function acquireIntegrationSuiteLock(
  lockPath = DEFAULT_INTEGRATION_SUITE_LOCK_PATH
): Promise<FileHandle> {
  const deadline = Date.now() + resolveIntegrationSuiteLockTimeoutMs();

  while (Date.now() < deadline) {
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

      await sleep(INTEGRATION_SUITE_LOCK_POLL_MS);
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
