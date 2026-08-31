#!/usr/bin/env node

/**
 * CLI for reading, writing, and validating the promotion-evidence snapshot used by the release-state gate.
 *
 * Invoked by: GitHub Actions deploy and staging workflows; `release-state-cli.test.ts`.
 * Usage: node scripts/promotion-evidence-cli.mjs read|write|validate [options]
 * Env: RELEASE_STATE_PATH.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { isDirectExecution } from './lib/github-actions.mjs';
import { parseCommandLine, requireCliOption, runCli } from './lib/release-cli.mjs';

const BEGIN_MARKER = 'CLASSROOMPATH_PROMOTION_EVIDENCE_V1_BEGIN';
const END_MARKER = 'CLASSROOMPATH_PROMOTION_EVIDENCE_V1_END';
const VALUE_FLAGS = [
  '--tag',
  '--commit',
  '--release-id',
  '--rc-run-id',
  '--classroompath-sha',
  '--staging-current',
  '--staging-verification',
  '--output',
  '--message-file',
  '--staging-current-output',
  '--staging-verification-output',
  '--identity-output',
  '--existing-message-file',
];

const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;
const CLASSROOMPATH_SHA_PATTERN = /^[0-9a-f]{40}$/;

function extractUniqueMarker(messageText, markerName) {
  const values = [
    ...String(messageText ?? '').matchAll(new RegExp(`^${markerName}:\\s*(\\S+)\\s*$`, 'gmu')),
  ].map((match) => match[1]);
  if (values.length === 0) {
    throw new Error(`Promotion tag identity is missing ${markerName}`);
  }
  if (values.length > 1) {
    throw new Error(`Promotion tag identity contains duplicate ${markerName}`);
  }
  return values[0];
}

export function buildProductionTagIdentity({ releaseId, rcRunId, classroomPathSha } = {}) {
  const normalizedReleaseId = String(releaseId ?? '').trim();
  const normalizedRcRunId = String(rcRunId ?? '').trim();
  const normalizedClassroomPathSha = String(classroomPathSha ?? '').trim();
  if (!RELEASE_ID_PATTERN.test(normalizedReleaseId)) {
    throw new Error('releaseId must be a 64-character lowercase SHA-256 hex string');
  }
  if (!/^[0-9]+$/.test(normalizedRcRunId)) {
    throw new Error('rcRunId is required and must be a numeric GitHub run id');
  }
  if (!CLASSROOMPATH_SHA_PATTERN.test(normalizedClassroomPathSha)) {
    throw new Error('classroomPathSha must be a 40-character lowercase SHA');
  }
  return {
    releaseId: normalizedReleaseId,
    rcRunId: normalizedRcRunId,
    classroomPathSha: normalizedClassroomPathSha,
  };
}

export function extractProductionTagIdentity(messageText) {
  return buildProductionTagIdentity({
    releaseId: extractUniqueMarker(messageText, 'ClassroomPath-Release-Id'),
    rcRunId: extractUniqueMarker(messageText, 'ClassroomPath-RC-Run-Id'),
    classroomPathSha: extractUniqueMarker(messageText, 'ClassroomPath-SHA'),
  });
}

export function compareProductionTagIdentity(actual, expected) {
  const actualIdentity = buildProductionTagIdentity(actual);
  const expectedIdentity = buildProductionTagIdentity(expected);
  const mismatches = ['releaseId', 'rcRunId', 'classroomPathSha'].filter(
    (field) => actualIdentity[field] !== expectedIdentity[field]
  );
  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

export function serializeProductionTagIdentity(identity) {
  const validated = buildProductionTagIdentity(identity);
  return [
    `RELEASE_ID=${validated.releaseId}`,
    `RC_RUN_ID=${validated.rcRunId}`,
    `CLASSROOMPATH_SHA=${validated.classroomPathSha}`,
    '',
  ].join('\n');
}

export function writeProductionTagIdentityFile(outputPath, identity) {
  writeFileSync(outputPath, serializeProductionTagIdentity(identity), 'utf-8');
  return outputPath;
}

function requireOption(options, name) {
  return requireCliOption(options, name, `Missing required option --${name}`);
}

function encodeFile(path) {
  return Buffer.from(readFileSync(path, 'utf-8'), 'utf-8').toString('base64');
}

function decodeField(fields, name) {
  const value = fields.get(name);
  if (!value) {
    throw new Error(`Promotion tag evidence is missing ${name}`);
  }
  return Buffer.from(value, 'base64').toString('utf-8');
}

function extractEvidenceFields(messageText) {
  const beginIndex = messageText.indexOf(BEGIN_MARKER);
  const endIndex = messageText.indexOf(END_MARKER);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw new Error('Promotion tag evidence block not found');
  }

  const block = messageText
    .slice(beginIndex + BEGIN_MARKER.length, endIndex)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = new Map();

  for (const line of block) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Invalid promotion evidence line: ${line}`);
    }
    fields.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }

  return fields;
}

function writeTagMessage(options) {
  const tag = requireOption(options, 'tag');
  const commit = requireOption(options, 'commit');
  const stagingCurrentPath = requireOption(options, 'staging-current');
  const stagingVerificationPath = requireOption(options, 'staging-verification');
  const outputPath = requireOption(options, 'output');
  const releaseId = options['release-id'] ?? '';
  const rcRunId = options['rc-run-id'] ?? '';
  const classroomPathSha = options['classroompath-sha'] ?? commit;
  const hasIdentityOption = Boolean(releaseId || rcRunId || options['classroompath-sha']);
  const identity = hasIdentityOption
    ? buildProductionTagIdentity({ releaseId, rcRunId, classroomPathSha })
    : null;

  const message = [
    `ClassroomPath production release ${tag}`,
    '',
    `Commit: ${commit}`,
    ...(identity
      ? [
          `ClassroomPath-Release-Id: ${identity.releaseId}`,
          `ClassroomPath-RC-Run-Id: ${identity.rcRunId}`,
          `ClassroomPath-SHA: ${identity.classroomPathSha}`,
        ]
      : []),
    'Promotion evidence: staging release state was verified locally before tag creation.',
    BEGIN_MARKER,
    `staging-current-images.env.base64=${encodeFile(stagingCurrentPath)}`,
    `staging-verification.env.base64=${encodeFile(stagingVerificationPath)}`,
    END_MARKER,
    '',
  ].join('\n');

  writeFileSync(outputPath, message, 'utf-8');
}

function extractTagMessage(options) {
  const messagePath = requireOption(options, 'message-file');
  const stagingCurrentOutput = requireOption(options, 'staging-current-output');
  const stagingVerificationOutput = requireOption(options, 'staging-verification-output');
  const messageText = readFileSync(messagePath, 'utf-8');
  const fields = extractEvidenceFields(messageText);

  writeFileSync(
    stagingCurrentOutput,
    decodeField(fields, 'staging-current-images.env.base64'),
    'utf-8'
  );
  writeFileSync(
    stagingVerificationOutput,
    decodeField(fields, 'staging-verification.env.base64'),
    'utf-8'
  );

  const hasReleaseIdentity =
    /^(?:ClassroomPath-Release-Id|ClassroomPath-RC-Run-Id|ClassroomPath-SHA):/mu.test(messageText);
  if (hasReleaseIdentity) {
    const identity = extractProductionTagIdentity(messageText);
    const identityOutput = options['identity-output'];
    if (identityOutput) {
      writeProductionTagIdentityFile(identityOutput, identity);
    }
  }
}

function extractTagIdentity(options) {
  const messagePath = requireOption(options, 'message-file');
  const outputPath = requireOption(options, 'identity-output');
  const identity = extractProductionTagIdentity(readFileSync(messagePath, 'utf-8'));
  writeProductionTagIdentityFile(outputPath, identity);
}

function writeTagIdentity(options) {
  const outputPath = requireOption(options, 'identity-output');
  writeProductionTagIdentityFile(
    outputPath,
    buildProductionTagIdentity({
      releaseId: requireOption(options, 'release-id'),
      rcRunId: requireOption(options, 'rc-run-id'),
      classroomPathSha: requireOption(options, 'classroompath-sha'),
    })
  );
}

function verifyTagIdentity(options) {
  const messagePath = requireOption(options, 'message-file');
  const actual = extractProductionTagIdentity(readFileSync(messagePath, 'utf-8'));
  const expected = buildProductionTagIdentity({
    releaseId: requireOption(options, 'release-id'),
    rcRunId: requireOption(options, 'rc-run-id'),
    classroomPathSha: requireOption(options, 'classroompath-sha'),
  });
  const comparison = compareProductionTagIdentity(actual, expected);
  if (!comparison.matches) {
    throw new Error(
      `Production tag identity conflicts with the exact Release Bundle: ${comparison.mismatches.join(', ')}`
    );
  }
}

function main(argv) {
  const { command, options } = parseCommandLine(argv, { valueFlags: VALUE_FLAGS });

  switch (command) {
    case 'write-tag-message':
      writeTagMessage(options);
      return;
    case 'extract-tag-message':
      extractTagMessage(options);
      return;
    case 'extract-tag-identity':
      extractTagIdentity(options);
      return;
    case 'write-tag-identity':
      writeTagIdentity(options);
      return;
    case 'verify-tag-identity':
      verifyTagIdentity(options);
      return;
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  runCli(main);
}
