import { createServer } from 'node:net';

export interface WaitForHealthOptions {
  path?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr !== null && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => {
          resolve(port);
        });
      } else {
        reject(new Error('Failed to get port'));
      }
    });
    server.on('error', reject);
  });
}

export async function waitForHealth(
  baseUrl: string,
  options: WaitForHealthOptions = {}
): Promise<void> {
  const path = options.path ?? '/cp/health';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 200;

  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok) return;
      lastFailure = `status ${String(response.status)}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for health endpoint ${baseUrl}${path}: ${lastFailure}`);
}
