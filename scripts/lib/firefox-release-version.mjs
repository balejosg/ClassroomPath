import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const firefoxReleaseVersionSegmentModulo = 1_000_000_000n;

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

export function normalizeCiBuildSegment(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(`ci-build-segment must be numeric, got ${JSON.stringify(value)}`);
  }

  return (BigInt(normalizedValue) % firefoxReleaseVersionSegmentModulo).toString();
}

export function deriveFirefoxReleaseVersion({ baseVersion, ciBuildSegment, runId, runAttempt }) {
  const normalizedBaseVersion = validateFirefoxReleaseVersion(baseVersion);
  let normalizedCiBuildSegment = '';

  if (ciBuildSegment === undefined) {
    const normalizedAttempt = String(runAttempt ?? '').trim();

    if (!/^\d+$/.test(normalizedAttempt)) {
      throw new Error(`run-attempt must be numeric, got ${JSON.stringify(runAttempt)}`);
    }

    normalizedCiBuildSegment = `${normalizeRunIdSuffix(runId)}${normalizedAttempt.padStart(
      2,
      '0'
    )}`;
  } else {
    normalizedCiBuildSegment = normalizeCiBuildSegment(ciBuildSegment);
  }

  if (!/^\d+$/.test(normalizedCiBuildSegment)) {
    throw new Error(`ci-build-segment must be numeric, got ${JSON.stringify(ciBuildSegment)}`);
  }
  return validateFirefoxReleaseVersion(`${normalizedBaseVersion}.${normalizedCiBuildSegment}`);
}

export function deriveFirefoxReleaseVersionFromManifest({
  manifestPath,
  ciBuildSegment,
  runId,
  runAttempt,
}) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  return deriveFirefoxReleaseVersion({
    baseVersion: String(manifest.version ?? '').trim(),
    ciBuildSegment,
    runId,
    runAttempt,
  });
}

export function deriveFirefoxReleaseVersionFromSourceRevision({
  manifestPath,
  sourceRevision,
  execFileSyncImpl = execFileSync,
}) {
  const commitTimestamp = String(
    execFileSyncImpl('git', ['-C', sourceRevision, 'show', '-s', '--format=%ct', 'HEAD'], {
      encoding: 'utf8',
    })
  ).trim();

  return deriveFirefoxReleaseVersionFromManifest({
    manifestPath,
    ciBuildSegment: commitTimestamp,
  });
}
