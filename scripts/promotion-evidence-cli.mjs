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

import { parseCommandLine, requireCliOption, runCli } from './lib/release-cli.mjs';

const BEGIN_MARKER = 'CLASSROOMPATH_PROMOTION_EVIDENCE_V1_BEGIN';
const END_MARKER = 'CLASSROOMPATH_PROMOTION_EVIDENCE_V1_END';
const VALUE_FLAGS = [
  '--tag',
  '--commit',
  '--staging-current',
  '--staging-verification',
  '--output',
  '--message-file',
  '--staging-current-output',
  '--staging-verification-output',
];

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

  const message = [
    `ClassroomPath production release ${tag}`,
    '',
    `Commit: ${commit}`,
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
  const fields = extractEvidenceFields(readFileSync(messagePath, 'utf-8'));

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
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

runCli(main);
