/**
 * Retry helpers that survive a single dropped network connection on a self-hosted runner.
 * Only failures that happened before a response arrived are retried; an HTTP response of any
 * status is always returned to the caller unchanged.
 *
 * Invoked by: release/promotion scripts (actions-health, release-evidence-bundle, OpenPath
 * promotion checks). Not for canary or product-behavior harnesses, where retries could mask
 * product failures.
 * Env: CLASSROOMPATH_NETWORK_RETRY_DELAY_MS (base delay in ms, default 5000, multiplied by attempt).
 */

export const NETWORK_RETRY_ATTEMPTS = 4;

// gh failures where the request never reached GitHub.
const GITHUB_CLI_CONNECTION_ERROR_PATTERN =
  /error connecting to|dial tcp|i\/o timeout|TLS handshake timeout|connection reset by peer|no such host/i;

const ALWAYS_TRANSIENT_FETCH_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const IDEMPOTENT_ONLY_FETCH_CODES = new Set(['ECONNRESET', 'UND_ERR_SOCKET']);

/**
 * @param {string} stderr
 * @returns {boolean}
 */
export function isTransientGitHubCliError(stderr) {
  return GITHUB_CLI_CONNECTION_ERROR_PATTERN.test(String(stderr ?? ''));
}

/**
 * @param {unknown} error
 * @param {string} [method]
 * @returns {boolean}
 */
export function isTransientFetchError(error, method = 'GET') {
  if (!(error instanceof TypeError) || error.message !== 'fetch failed') {
    return false;
  }
  const code = /** @type {{cause?: {code?: unknown}}} */ (error).cause?.code;
  if (typeof code !== 'string') {
    return false;
  }
  if (ALWAYS_TRANSIENT_FETCH_CODES.has(code)) {
    return true;
  }
  const upperMethod = String(method).toUpperCase();
  return IDEMPOTENT_ONLY_FETCH_CODES.has(code) && (upperMethod === 'GET' || upperMethod === 'HEAD');
}

/**
 * @returns {number}
 */
function retryDelayMs() {
  const value = Number(process.env.CLASSROOMPATH_NETWORK_RETRY_DELAY_MS ?? 5000);
  return Number.isFinite(value) && value >= 0 ? value : 5000;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {() => Promise<T>} run
 * @param {(error: unknown) => boolean} isTransient
 * @param {string} [label]
 * @returns {Promise<T>}
 */
export async function withConnectionRetryAsync(run, isTransient, label = 'request') {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= NETWORK_RETRY_ATTEMPTS || !isTransient(error)) {
        throw error;
      }
      process.stderr.write(
        `${label} could not connect (attempt ${String(attempt)}/${String(NETWORK_RETRY_ATTEMPTS)}); retrying\n`
      );
      await sleep(retryDelayMs() * attempt);
    }
  }
}

/**
 * fetch() that retries only thrown transient connection errors.
 *
 * @param {string | URL | Request} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function fetchWithConnectionRetry(url, init) {
  const method = init?.method ?? (url instanceof Request ? url.method : 'GET');
  return withConnectionRetryAsync(
    () => fetch(url, init),
    (error) => isTransientFetchError(error, method),
    'fetch'
  );
}
