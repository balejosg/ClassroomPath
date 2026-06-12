/**
 * Fetches per-group diagnostics from the ClassroomPath canary API and formats them for evidence records.
 *
 * Invoked by: Imported by `linux-ajax-auto-allow-canary.mjs`; tested by `linux-auto-allow-canary.test.ts`.
 * Usage: (library module, not invoked directly)
 * Env: LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN.
 */
export async function collectCanaryGroupDiagnostics({
  apiUrl,
  groupId,
  adminToken,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 3,
}) {
  const normalizedApiUrl = (apiUrl ?? '').replace(/\/$/, '');
  if (!normalizedApiUrl || !groupId || !adminToken) {
    return { available: false, reason: 'missing diagnostics context' };
  }

  const url = `${normalizedApiUrl}/cp/internal/client-canary/group/${encodeURIComponent(
    groupId
  )}/diagnostics`;
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await response.json().catch(() => null);
      lastResult = {
        available: true,
        status: response.status,
        body,
        attempt,
      };
      if (response.status !== 429 || attempt === maxAttempts) {
        return lastResult;
      }

      const retryAfterMs = Number(body?.error?.data?.retryAfterMs ?? 0);
      await sleep(Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 5000);
    } catch (error) {
      lastResult = {
        available: false,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      };
      if (attempt === maxAttempts) {
        return lastResult;
      }
      await sleep(1000 * attempt);
    }
  }

  return lastResult ?? { available: false, reason: 'diagnostics request did not run' };
}
