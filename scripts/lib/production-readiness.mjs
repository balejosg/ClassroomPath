/**
 * Canonical, read-only production-readiness contract.
 *
 * This module owns the order, identity binding, blocker vocabulary, and safe
 * rendering of readiness checks. Deploy adapters and the CLI provide the
 * check implementations; this module never mutates a host, checkout, tag, or
 * release-state pointer.
 */

const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RC_RUN_ID_PATTERN = /^\d+$/;

export const READINESS_CHECKS = Object.freeze([
  Object.freeze({ name: 'rc', blocker: 'RC_BLOCKER' }),
  Object.freeze({ name: 'staging', blocker: 'STAGING_BLOCKER' }),
  Object.freeze({ name: 'recovery', blocker: 'RECOVERY_BLOCKER' }),
  Object.freeze({ name: 'config', blocker: 'CONFIG_BLOCKER' }),
  Object.freeze({ name: 'host', blocker: 'HOST_BLOCKER' }),
  Object.freeze({ name: 'artifacts', blocker: 'ARTIFACT_BLOCKER' }),
]);

export const READINESS_BLOCKERS = Object.freeze(READINESS_CHECKS.map((check) => check.blocker));

export function validateRecoveryIdentity({ candidateSha, recoverySha } = {}) {
  const normalizedCandidateSha = normalizeRequired(candidateSha, SHA40_PATTERN, 'candidateSha');
  const normalizedRecoverySha = normalizeRequired(recoverySha, SHA40_PATTERN, 'recoverySha');
  if (normalizedCandidateSha === normalizedRecoverySha) {
    throw new Error('recoverySha must differ from candidateSha');
  }
  return { candidateSha: normalizedCandidateSha, recoverySha: normalizedRecoverySha };
}

export function normalizeProductionReadinessIdentity(identity = {}) {
  const normalized = {
    rcRunId: normalizeRequired(identity.rcRunId, RC_RUN_ID_PATTERN, 'rcRunId'),
    candidateSha: normalizeRequired(identity.candidateSha, SHA40_PATTERN, 'candidateSha'),
    releaseId: normalizeRequired(identity.releaseId, SHA256_PATTERN, 'releaseId'),
    openpathSha: normalizeRequired(identity.openpathSha, SHA40_PATTERN, 'openpathSha'),
    contractSha256: normalizeRequired(identity.contractSha256, SHA256_PATTERN, 'contractSha256'),
  };

  const recoverySha = String(identity.recoverySha ?? '').trim();
  if (recoverySha && !SHA40_PATTERN.test(recoverySha)) {
    throw new Error('recoverySha must be a 40-character lowercase SHA when present');
  }
  if (recoverySha) normalized.recoverySha = recoverySha;
  return normalized;
}

export function sanitizeReadinessMessage(value) {
  let message = String(value ?? '').trim();
  if (!message) return 'check did not provide a message';

  message = message
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(
      /((?:token|secret|password|passwd|private[_ -]?key|authorization|credential)[\w -]*\s*[=:]\s*)[^\s,;]+/gi,
      '$1[redacted]'
    )
    .replace(/(-----BEGIN [^-]+-----)[\s\S]*?(-----END [^-]+-----)/gi, '$1[redacted]$2');

  return message.slice(0, 400);
}

export function buildProductionReadinessReport({ identity, checks = {} } = {}) {
  const normalizedIdentity = normalizeProductionReadinessIdentity(identity);
  const checkMap = Array.isArray(checks)
    ? Object.fromEntries(checks.map((check) => [String(check?.name ?? ''), check]))
    : checks;
  const normalizedChecks = {};
  const blockers = [];

  for (const definition of READINESS_CHECKS) {
    const raw = checkMap?.[definition.name] ?? {};
    const ok = raw.ok === true;
    const check = {
      ok,
      blocker: ok ? null : definition.blocker,
      message: sanitizeReadinessMessage(
        raw.message ?? (ok ? `${definition.name} check passed` : `${definition.name} check blocked`)
      ),
    };
    normalizedChecks[definition.name] = check;
    if (!ok) blockers.push(definition.blocker);
  }

  return {
    ok: blockers.length === 0,
    identity: normalizedIdentity,
    checks: normalizedChecks,
    blockers,
    mutationAttempted: false,
  };
}

export async function runProductionReadiness({ identity, checks = {} } = {}) {
  const normalizedIdentity = normalizeProductionReadinessIdentity(identity);
  const checkMap = Array.isArray(checks)
    ? Object.fromEntries(checks.map((check) => [String(check?.name ?? ''), check]))
    : checks;
  const results = {};

  for (const definition of READINESS_CHECKS) {
    const check = checkMap?.[definition.name];
    if (typeof check !== 'function') {
      results[definition.name] = {
        ok: false,
        message: `${definition.name} check is not configured`,
      };
      continue;
    }

    try {
      results[definition.name] = (await check({
        identity: normalizedIdentity,
        name: definition.name,
      })) ?? {
        ok: false,
        message: `${definition.name} check returned no result`,
      };
    } catch (error) {
      results[definition.name] = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return buildProductionReadinessReport({ identity: normalizedIdentity, checks: results });
}

function normalizeRequired(value, pattern, label) {
  const normalized = String(value ?? '').trim();
  if (!pattern.test(normalized)) {
    throw new Error(`${label} has an invalid exact identity`);
  }
  return normalized;
}
