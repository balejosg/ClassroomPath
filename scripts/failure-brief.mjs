#!/usr/bin/env node

/**
 * Library: builds and renders the failure brief Markdown from a failed GitHub Actions workflow run.
 *
 * Invoked by: Imported by `scripts/failure-brief.mjs`.
 * Usage: (library module, not invoked directly)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  buildFailureBrief,
  renderFailureBriefJson,
  renderFailureBriefMarkdown,
} from './lib/failure-brief.mjs';

function usage() {
  return `Usage: npm run ops:failure-brief -- --artifact <path> [options]

Options:
  --artifact <path>       Canary, diagnostic, or release evidence JSON.
  --kind <kind>           auto | windows-ajax | linux-ajax | linux-firefox | release-evidence | unknown
                         Default: auto
  --format <format>       markdown | json. Default: markdown
  --output <path>         Optional output file. Defaults to stdout only.
  --help                  Show this help.
`;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    artifactPath: '',
    kind: 'auto',
    format: 'markdown',
    outputPath: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--artifact':
        options.artifactPath = readValue(argv, ++index, arg);
        break;
      case '--kind':
        options.kind = readValue(argv, ++index, arg);
        break;
      case '--format':
        options.format = readValue(argv, ++index, arg);
        break;
      case '--output':
        options.outputPath = readValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && !options.artifactPath) {
    throw new Error('--artifact is required');
  }
  if (!['markdown', 'json'].includes(options.format)) {
    throw new Error('--format must be markdown or json');
  }

  return options;
}

function writeOutput(outputPath, content) {
  if (!outputPath) return;
  const absolutePath = resolve(outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const brief = buildFailureBrief({
    artifactPath: options.artifactPath,
    kind: options.kind,
  });
  const content =
    options.format === 'json'
      ? renderFailureBriefJson(brief)
      : `${renderFailureBriefMarkdown(brief)}\n`;

  writeOutput(options.outputPath, content);
  process.stdout.write(content);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(1);
}
