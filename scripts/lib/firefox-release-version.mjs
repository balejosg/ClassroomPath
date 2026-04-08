import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function normalizeRunIdSuffix(runId, suffixLength = 7) {
  const normalizedRunId = String(runId ?? '').trim();
  if (!/^\d+$/.test(normalizedRunId)) {
    throw new Error(`run-id must be numeric, got ${JSON.stringify(runId)}`);
  }

  const suffix = normalizedRunId.slice(-suffixLength);
  return String(Number.parseInt(suffix, 10));
}

export function validateFirefoxReleaseVersion(version) {
  const normalizedVersion = String(version ?? '').trim();
  if (!normalizedVersion) {
    throw new Error('Firefox release version must not be empty');
  }

  const segments = normalizedVersion.split('.');
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Firefox release version ${normalizedVersion} contains an empty segment`);
  }

  for (const segment of segments) {
    if (/^\d+$/.test(segment) && segment.length > 1 && segment.startsWith('0')) {
      throw new Error(
        `Firefox release version ${normalizedVersion} contains a numeric segment with a leading zero (${segment})`
      );
    }
  }

  return normalizedVersion;
}

export function deriveFirefoxReleaseVersion({ baseVersion, runId, runAttempt }) {
  const normalizedBaseVersion = validateFirefoxReleaseVersion(baseVersion);
  const normalizedAttempt = String(runAttempt ?? '').trim();

  if (!/^\d+$/.test(normalizedAttempt)) {
    throw new Error(`run-attempt must be numeric, got ${JSON.stringify(runAttempt)}`);
  }

  const runIdComponent = normalizeRunIdSuffix(runId);
  const ciBuildSegment = `${runIdComponent}${normalizedAttempt.padStart(2, '0')}`;

  return validateFirefoxReleaseVersion(`${normalizedBaseVersion}.${ciBuildSegment}`);
}

export function deriveFirefoxReleaseVersionFromManifest({ manifestPath, runId, runAttempt }) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  return deriveFirefoxReleaseVersion({
    baseVersion: String(manifest.version ?? '').trim(),
    runId,
    runAttempt,
  });
}
