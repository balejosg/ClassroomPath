import type { Locator } from '@playwright/test';

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 500, operationName = 'operation' } = options;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(
        `[Retry] ${operationName} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries} retries`);
}

export async function waitForAnyVisible(
  locators: Locator[],
  timeout: number,
  description: string
): Promise<void> {
  try {
    await Promise.any(locators.map((locator) => locator.waitFor({ state: 'visible', timeout })));
  } catch {
    throw new Error(`Timed out waiting for ${description}`);
  }
}

export async function waitForVisibleResult<T extends string>(
  candidates: Array<{ label: T; locator: Locator }>,
  timeout: number,
  description: string
): Promise<T> {
  try {
    return await Promise.any(
      candidates.map(({ label, locator }) =>
        locator.waitFor({ state: 'visible', timeout }).then(() => label)
      )
    );
  } catch {
    throw new Error(`Timed out waiting for ${description}`);
  }
}

export function parseTrpcResult<T>(responseText: string, description: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Failed to parse ${description}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Invalid ${description}: missing tRPC envelope`);
  }

  const errorMessage =
    'error' in entry &&
    entry.error &&
    typeof entry.error === 'object' &&
    'message' in entry.error &&
    typeof entry.error.message === 'string'
      ? entry.error.message
      : null;

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const data =
    'result' in entry && entry.result && typeof entry.result === 'object' && 'data' in entry.result
      ? (entry.result.data as T | undefined)
      : undefined;

  if (data === undefined) {
    throw new Error(`Invalid ${description}: missing result data`);
  }

  return data;
}
