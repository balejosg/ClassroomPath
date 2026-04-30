import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const RELEASE_STATE_SNAPSHOT_DEFINITIONS = {
  'current-runtime': [
    'APP_SHA',
    'IMAGE_SOURCE',
    'CLASSROOMPATH_GATEWAY_IMAGE',
    'CLASSROOMPATH_MIGRATIONS_IMAGE',
    'OPENPATH_FIREFOX_ASSETS_IMAGE',
    'OPENPATH_API_IMAGE',
    'OPENPATH_VERSION',
    'OPENPATH_LINUX_AGENT_VERSION',
    'CLASSROOMPATH_SPA_IMAGE',
  ],
  'deploy-context': [
    'TARGET_SHA',
    'APP_SHA',
    'PREVIOUS_APP_SHA',
    'IMAGE_SOURCE',
    'MIGRATION_RISK_LEVEL',
    'MIGRATION_CHANGED_FILES',
    'MIGRATION_DESTRUCTIVE_FILES',
    'PRODUCTION_BACKUP_REFERENCE',
    'DB_MIGRATED',
    'FAILURE_STAGE',
    'DEPLOY_FAILURE_STAGE',
    'ROLLBACK_ATTEMPTED',
    'ROLLBACK_RESULT',
  ],
  'staging-verification': [
    'STAGING_VERIFIED_AT',
    'STAGING_VERIFIED_BY',
    'STAGING_VERIFIED_APP_SHA',
    'STAGING_VERIFIED_OPENPATH_SHA',
    'STAGING_VERIFIED_IMAGE_SOURCE',
    'STAGING_VERIFIED_GATEWAY_IMAGE',
    'STAGING_VERIFIED_MIGRATIONS_IMAGE',
    'STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE',
    'STAGING_VERIFIED_OPENPATH_API_IMAGE',
    'STAGING_VERIFIED_OPENPATH_VERSION',
    'STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION',
    'STAGING_VERIFIED_SPA_IMAGE',
    'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS',
    'STAGING_EMAIL_PREFLIGHT_MODE',
    'STAGING_EMAIL_DELIVERY_HIGH_RISK',
    'STAGING_EMAIL_PREFLIGHT_RESULT',
    'STAGING_EMAIL_PREFLIGHT_PROVIDER',
    'STAGING_WINDOWS_FIREFOX_HIGH_RISK',
    'STAGING_SMOKE_RESULT',
    'STAGING_SMOKE_STATUS',
    'STAGING_RELEASE_GATE_RESULT',
    'STAGING_WINDOWS_BOOTSTRAP_RESULT',
    'STAGING_FIREFOX_POLICY_RESULT',
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
    'STAGING_LINUX_BOOTSTRAP_RESULT',
    'STAGING_LINUX_BOOTSTRAP_RUN_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE',
  ],
  'staging-verification-run': [
    'SMOKE_TARGET_URL',
    'SMOKE_SKIP_CORS',
    'STAGING_SMOKE_RESULT',
    'STAGING_SMOKE_STATUS',
    'RELEASE_GATE_TARGET_URL',
    'RELEASE_GATE_EXPECTED_ORIGIN',
    'STAGING_RELEASE_GATE_RESULT',
    'STAGING_VERIFIED_AT',
    'STAGING_EMAIL_PREFLIGHT_MODE',
    'STAGING_EMAIL_DELIVERY_HIGH_RISK',
    'STAGING_EMAIL_PREFLIGHT_RESULT',
    'STAGING_EMAIL_PREFLIGHT_PROVIDER',
    'STAGING_WINDOWS_FIREFOX_HIGH_RISK',
    'STAGING_FIREFOX_RELEASE_ARTIFACTS',
    'STAGING_WINDOWS_BOOTSTRAP_RESULT',
    'STAGING_FIREFOX_POLICY_RESULT',
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
    'STAGING_LINUX_BOOTSTRAP_RESULT',
    'STAGING_LINUX_BOOTSTRAP_RUN_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE',
  ],
};

const SAFE_SHELL_VALUE_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;

function assertSnapshotType(snapshotType) {
  if (!(snapshotType in RELEASE_STATE_SNAPSHOT_DEFINITIONS)) {
    throw new Error(`Unknown release state snapshot type: ${snapshotType}`);
  }

  return RELEASE_STATE_SNAPSHOT_DEFINITIONS[snapshotType];
}

export function getReleaseStateSnapshotFields(snapshotType) {
  return [...assertSnapshotType(snapshotType)];
}

function decodeAnsiCString(text) {
  let output = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char !== '\\') {
      output += char;
      continue;
    }

    index += 1;

    if (index >= text.length) {
      output += '\\';
      break;
    }

    const escape = text[index];

    switch (escape) {
      case 'a':
        output += '\u0007';
        break;
      case 'b':
        output += '\b';
        break;
      case 'e':
      case 'E':
        output += '\u001b';
        break;
      case 'f':
        output += '\f';
        break;
      case 'n':
        output += '\n';
        break;
      case 'r':
        output += '\r';
        break;
      case 't':
        output += '\t';
        break;
      case 'v':
        output += '\v';
        break;
      case '\\':
        output += '\\';
        break;
      case "'":
        output += "'";
        break;
      case '"':
        output += '"';
        break;
      case 'x': {
        const hex = text.slice(index + 1, index + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          output += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 2;
        } else {
          output += 'x';
        }
        break;
      }
      case 'u': {
        const hex = text.slice(index + 1, index + 5);
        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
          output += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 4;
        } else {
          output += 'u';
        }
        break;
      }
      case 'U': {
        const hex = text.slice(index + 1, index + 9);
        if (/^[0-9A-Fa-f]{8}$/.test(hex)) {
          output += String.fromCodePoint(Number.parseInt(hex, 16));
          index += 8;
        } else {
          output += 'U';
        }
        break;
      }
      default: {
        if (/[0-7]/.test(escape)) {
          let octal = escape;
          let consumed = 0;

          while (consumed < 2 && index + 1 < text.length && /[0-7]/.test(text[index + 1])) {
            octal += text[index + 1];
            index += 1;
            consumed += 1;
          }

          output += String.fromCodePoint(Number.parseInt(octal, 8));
        } else {
          output += escape;
        }
      }
    }
  }

  return output;
}

function parseShellValue(rawValue) {
  if (rawValue === "''") {
    return '';
  }

  if (rawValue.startsWith("$'") && rawValue.endsWith("'")) {
    return decodeAnsiCString(rawValue.slice(2, -1));
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  let value = '';

  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];

    if (char === '\\' && index + 1 < rawValue.length) {
      value += rawValue[index + 1];
      index += 1;
      continue;
    }

    value += char;
  }

  return value;
}

function escapeAnsiCString(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\\']/g, (char) => {
    switch (char) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      case '\v':
        return '\\v';
      case '\f':
        return '\\f';
      case '\b':
        return '\\b';
      case '\\':
        return '\\\\';
      case "'":
        return "\\'";
      default:
        return `\\x${char.codePointAt(0).toString(16).padStart(2, '0')}`;
    }
  });
}

export function shellQuote(value) {
  const normalized = String(value ?? '');

  if (normalized.length === 0) {
    return "''";
  }

  if (SAFE_SHELL_VALUE_RE.test(normalized)) {
    return normalized;
  }

  if (/[\u0000-\u001f\u007f-\u009f'\\]/.test(normalized)) {
    return `$'${escapeAnsiCString(normalized)}'`;
  }

  return normalized.replace(/([^A-Za-z0-9_@%+=:,./-])/g, '\\$1');
}

export function parseReleaseStateText(text) {
  const snapshot = {};

  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    snapshot[key] = parseShellValue(rawValue);
  }

  return snapshot;
}

export function readReleaseStateSnapshot(snapshotPath) {
  return parseReleaseStateText(readFileSync(snapshotPath, 'utf-8'));
}

export function collectReleaseStateSnapshot(snapshotType, source = process.env) {
  const fields = getReleaseStateSnapshotFields(snapshotType);
  return Object.fromEntries(fields.map((field) => [field, String(source[field] ?? '')]));
}

export function serializeReleaseStateSnapshot(snapshotType, source = process.env) {
  const snapshot = collectReleaseStateSnapshot(snapshotType, source);
  return `${Object.entries(snapshot)
    .map(([field, value]) => `${field}=${shellQuote(value)}`)
    .join('\n')}\n`;
}

export function writeReleaseStateSnapshot(snapshotType, snapshotPath, source = process.env) {
  mkdirSync(dirname(resolve(snapshotPath)), { recursive: true });
  writeFileSync(snapshotPath, serializeReleaseStateSnapshot(snapshotType, source), 'utf-8');
}

export function validateCurrentReleaseState(snapshot, expected) {
  const errors = [];

  if ((snapshot.IMAGE_SOURCE ?? '') !== 'release-candidate') {
    errors.push(
      `::error::Staging is not running release candidate images (IMAGE_SOURCE=${snapshot.IMAGE_SOURCE ?? 'unset'})`
    );
  }

  const comparisons = [
    ['Staging APP_SHA', expected.EXPECTED_APP_SHA, snapshot.APP_SHA],
    ['Gateway image', expected.EXPECTED_GATEWAY_IMAGE, snapshot.CLASSROOMPATH_GATEWAY_IMAGE],
    [
      'Migrations image',
      expected.EXPECTED_MIGRATIONS_IMAGE,
      snapshot.CLASSROOMPATH_MIGRATIONS_IMAGE,
    ],
    [
      'OpenPath Firefox assets image',
      expected.EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE,
      snapshot.OPENPATH_FIREFOX_ASSETS_IMAGE,
    ],
    ['OpenPath API image', expected.EXPECTED_OPENPATH_API_IMAGE, snapshot.OPENPATH_API_IMAGE],
    ['OpenPath version', expected.EXPECTED_OPENPATH_VERSION, snapshot.OPENPATH_VERSION],
    ['SPA image', expected.EXPECTED_SPA_IMAGE, snapshot.CLASSROOMPATH_SPA_IMAGE],
    [
      'OpenPath Linux agent version',
      expected.EXPECTED_OPENPATH_LINUX_AGENT_VERSION,
      snapshot.OPENPATH_LINUX_AGENT_VERSION,
    ],
  ];

  for (const [label, expectedValue, actualValue] of comparisons) {
    if (String(expectedValue ?? '') !== String(actualValue ?? '')) {
      errors.push(`::error::${label} mismatch. expected=${expectedValue} actual=${actualValue}`);
    }
  }

  return errors;
}

export function validateStagingVerification(snapshot, expected) {
  const errors = [];

  if ((snapshot.STAGING_SMOKE_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Staging smoke evidence is missing or failed (STAGING_SMOKE_RESULT=${snapshot.STAGING_SMOKE_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_RELEASE_GATE_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Staging release-gate evidence is missing or failed (STAGING_RELEASE_GATE_RESULT=${snapshot.STAGING_RELEASE_GATE_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_VERIFIED_IMAGE_SOURCE ?? '') !== 'release-candidate') {
    errors.push(
      `::error::Staging verification evidence does not point to release candidate images (STAGING_VERIFIED_IMAGE_SOURCE=${snapshot.STAGING_VERIFIED_IMAGE_SOURCE ?? 'unset'})`
    );
  }

  const comparisons = [
    ['Staging verification SHA', expected.EXPECTED_APP_SHA, snapshot.STAGING_VERIFIED_APP_SHA],
    [
      'Verified gateway image',
      expected.EXPECTED_GATEWAY_IMAGE,
      snapshot.STAGING_VERIFIED_GATEWAY_IMAGE,
    ],
    [
      'Verified migrations image',
      expected.EXPECTED_MIGRATIONS_IMAGE,
      snapshot.STAGING_VERIFIED_MIGRATIONS_IMAGE,
    ],
    [
      'Verified OpenPath Firefox assets image',
      expected.EXPECTED_OPENPATH_FIREFOX_ASSETS_IMAGE,
      snapshot.STAGING_VERIFIED_OPENPATH_FIREFOX_ASSETS_IMAGE,
    ],
    [
      'Verified OpenPath API image',
      expected.EXPECTED_OPENPATH_API_IMAGE,
      snapshot.STAGING_VERIFIED_OPENPATH_API_IMAGE,
    ],
    [
      'Verified OpenPath version',
      expected.EXPECTED_OPENPATH_VERSION,
      snapshot.STAGING_VERIFIED_OPENPATH_VERSION,
    ],
    ['Verified SPA image', expected.EXPECTED_SPA_IMAGE, snapshot.STAGING_VERIFIED_SPA_IMAGE],
    [
      'Verified OpenPath Linux agent version',
      expected.EXPECTED_OPENPATH_LINUX_AGENT_VERSION,
      snapshot.STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION,
    ],
  ];

  for (const [label, expectedValue, actualValue] of comparisons) {
    if (String(expectedValue ?? '') !== String(actualValue ?? '')) {
      errors.push(`::error::${label} mismatch. expected=${expectedValue} actual=${actualValue}`);
    }
  }

  return errors;
}

export function validateHighRiskStagingVerification(snapshot) {
  const errors = [];

  if ((snapshot.STAGING_SMOKE_STATUS ?? '') === 'PASS_WITH_FALLBACK') {
    errors.push(
      '::error::PASS_WITH_FALLBACK is not sufficient production evidence for Windows/Firefox delivery changes'
    );
  }

  if ((snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Windows bootstrap evidence is missing or failed (STAGING_WINDOWS_BOOTSTRAP_RESULT=${snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_FIREFOX_POLICY_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Firefox policy evidence is missing or failed (STAGING_FIREFOX_POLICY_RESULT=${snapshot.STAGING_FIREFOX_POLICY_RESULT ?? 'unset'})`
    );
  }

  if ((snapshot.STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS ?? '') !== 'present') {
    errors.push(
      '::error::Firefox release artifacts were not marked present in staging verification evidence'
    );
  }

  if ((snapshot.STAGING_LINUX_BOOTSTRAP_RESULT ?? '') !== 'success') {
    errors.push(
      `::error::Linux bootstrap evidence is missing or failed (STAGING_LINUX_BOOTSTRAP_RESULT=${snapshot.STAGING_LINUX_BOOTSTRAP_RESULT ?? 'unset'}; boundary=${snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID ?? 'unset'})`
    );
  }

  for (const fieldName of [
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
  ]) {
    if (!snapshot[fieldName]) {
      errors.push(`::error::${fieldName} is missing from release-state evidence`);
    }
  }

  return errors;
}

export function buildStagingReleaseEvidenceOutputs(snapshot) {
  return {
    staging_smoke_result: snapshot.STAGING_SMOKE_RESULT ?? 'unknown',
    staging_smoke_status: snapshot.STAGING_SMOKE_STATUS ?? 'unknown',
    staging_release_gate_result: snapshot.STAGING_RELEASE_GATE_RESULT ?? 'unknown',
    staging_email_preflight_mode: snapshot.STAGING_EMAIL_PREFLIGHT_MODE ?? 'unknown',
    staging_email_delivery_high_risk: snapshot.STAGING_EMAIL_DELIVERY_HIGH_RISK ?? 'unknown',
    staging_email_preflight_result: snapshot.STAGING_EMAIL_PREFLIGHT_RESULT ?? 'unknown',
    staging_email_preflight_provider: snapshot.STAGING_EMAIL_PREFLIGHT_PROVIDER ?? 'unknown',
    staging_windows_bootstrap_result: snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT ?? 'unknown',
    staging_firefox_policy_result: snapshot.STAGING_FIREFOX_POLICY_RESULT ?? 'unknown',
    staging_firefox_extension_id: snapshot.STAGING_FIREFOX_EXTENSION_ID ?? 'unknown',
    staging_firefox_release_version: snapshot.STAGING_FIREFOX_RELEASE_VERSION ?? 'unknown',
    staging_firefox_metadata_sha256: snapshot.STAGING_FIREFOX_METADATA_SHA256 ?? 'unknown',
    staging_firefox_xpi_sha256: snapshot.STAGING_FIREFOX_XPI_SHA256 ?? 'unknown',
    staging_linux_bootstrap_result: snapshot.STAGING_LINUX_BOOTSTRAP_RESULT ?? 'unknown',
    staging_linux_bootstrap_run_id: snapshot.STAGING_LINUX_BOOTSTRAP_RUN_ID ?? 'unknown',
    staging_linux_bootstrap_failure_boundary_id:
      snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID ?? 'unknown',
    staging_linux_bootstrap_failure_boundary_message:
      snapshot.STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE ?? 'unknown',
    staging_verified_at: snapshot.STAGING_VERIFIED_AT ?? 'unknown',
  };
}
