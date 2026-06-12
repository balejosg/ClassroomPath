#!/usr/bin/env node

/**
 * CLI: verifies that required GHCR container images are accessible before a deploy.
 *
 * Invoked by: Developer CLI and GitHub Actions deploy workflows; tested by `ghcr-preflight.test.ts`.
 * Usage: node scripts/ghcr-preflight.mjs [--remote] [--images <list>]
 * Env: GHCR_TOKEN, GITHUB_REPOSITORY.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDirectExecution } from './lib/github-actions.mjs';
import {
  collectGhcrImagesFromManifest,
  loadEnvFile,
  preflightGhcrImages,
  preflightGhcrImagesOnStaging,
} from './lib/ghcr-preflight.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');

function usage() {
  return `Usage:
  node scripts/ghcr-preflight.mjs local --image <ghcr-ref> [--image <ghcr-ref> ...]
  node scripts/ghcr-preflight.mjs staging --manifest-file <release-candidate-images.env>

Checks GHCR image visibility before staging deploy mutates remote state.
`;
}

export async function runGhcrPreflightCommand(argv = process.argv, dependencies = {}) {
  const io = {
    stdout: dependencies.stdout ?? ((value) => process.stdout.write(value)),
    stderr: dependencies.stderr ?? ((value) => process.stderr.write(value)),
  };

  try {
    const options = parseArgs(argv.slice(2));
    const result =
      options.command === 'local'
        ? await preflightGhcrImages(options.images, dependencies)
        : await runStagingPreflight(options, dependencies);

    printResult(result, io);
    return { status: result.ok ? 0 : 1 };
  } catch (error) {
    io.stderr(`${error.message}\n\n${usage()}`);
    return { status: 2 };
  }
}

export function parseArgs(args) {
  const [command, ...rest] = args;

  if (command !== 'local' && command !== 'staging') {
    throw new Error('command must be local or staging');
  }

  const options = {
    command,
    images: [],
    manifestFile: '',
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    switch (arg) {
      case '--image':
        options.images.push(requireNextValue(rest, ++index, '--image'));
        break;
      case '--manifest-file':
        options.manifestFile = requireNextValue(rest, ++index, '--manifest-file');
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (command === 'local' && options.images.length === 0) {
    throw new Error('local preflight requires at least one --image');
  }

  if (command === 'staging' && !options.manifestFile) {
    throw new Error('staging preflight requires --manifest-file');
  }

  return options;
}

async function runStagingPreflight(options, dependencies) {
  const env = dependencies.env ?? process.env;
  const load = dependencies.loadEnvFile ?? loadEnvFile;

  load(resolve(projectRoot, '.env.local'), env);

  const images = collectGhcrImagesFromManifest(options.manifestFile);
  return preflightGhcrImagesOnStaging(images, { ...dependencies, env });
}

function printResult(result, io) {
  if (result.ok) {
    io.stdout(`GHCR preflight passed: checked ${result.imageCount} image(s)\n`);
    return;
  }

  io.stderr(`GHCR preflight failed: ${result.failure.kind}\n`);
  if (result.image) {
    io.stderr(`image: ${result.image}\n`);
  }
  io.stderr(`${result.failure.message}\n`);
  if (result.failure.raw) {
    io.stderr(`${result.failure.raw}\n`);
  }
}

function requireNextValue(args, index, name) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const result = await runGhcrPreflightCommand(process.argv);
  process.exit(result.status);
}
