// @ts-check

const CANARY_PROGRESS_PREFIX = 'CANARY_PROGRESS ';
const VALID_STATUSES = new Set(['started', 'passed', 'failed']);

function requireNonEmptyString(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${name} is required for canary progress`);
  }
  return normalized;
}

export function formatCanaryProgressLine(event) {
  const canary = requireNonEmptyString('canary', event?.canary);
  const phase = requireNonEmptyString('phase', event?.phase);
  const status = requireNonEmptyString('status', event?.status);
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unsupported canary progress status: ${status}`);
  }

  const payload = {
    canary,
    phase,
    status,
    elapsedMs: Math.max(0, Math.round(Number(event?.elapsedMs ?? 0))),
  };
  if (event?.boundaryId) payload.boundaryId = String(event.boundaryId);
  if (event?.message) payload.message = String(event.message);

  return `${CANARY_PROGRESS_PREFIX}${JSON.stringify(payload)}`;
}

export function createCanaryProgressReporter({ canary, output = console.error, now = Date.now }) {
  const startedAt = now();

  return (phase, status, details = {}) => {
    output(
      formatCanaryProgressLine({
        canary,
        phase,
        status,
        elapsedMs: now() - startedAt,
        ...details,
      })
    );
  };
}
