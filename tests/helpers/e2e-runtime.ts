export interface E2EWorkerRuntime {
  scopeToken: string;
  workerIndex: number;
  workerSlot: number;
}

function parseWorkerIndex(testWorkerIndex: string | undefined): number {
  const workerIndex = Number.parseInt(testWorkerIndex ?? '0', 10);
  if (!Number.isFinite(workerIndex) || workerIndex < 0) {
    return 0;
  }

  return workerIndex;
}

export function createE2EWorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
  workerAccountCount = Math.max(1, Number.parseInt(env.E2E_WORKER_ACCOUNT_COUNT ?? '8', 10) || 8)
): E2EWorkerRuntime {
  const workerIndex = parseWorkerIndex(env.TEST_WORKER_INDEX);
  const workerSlot = (workerIndex % workerAccountCount) + 1;

  return {
    scopeToken: `w${workerSlot}`,
    workerIndex,
    workerSlot,
  };
}

export function prefixWorkerScopedLocalPart(
  base: string,
  runtime: E2EWorkerRuntime = createE2EWorkerRuntime()
): string {
  return `${base}-${runtime.scopeToken}`;
}

export function prefixWorkerScopedLabel(
  label: string,
  runtime: E2EWorkerRuntime = createE2EWorkerRuntime()
): string {
  return `${label} W${String(runtime.workerSlot)}`;
}
