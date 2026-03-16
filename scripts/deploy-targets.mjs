import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');
const configPath = resolve(projectRoot, 'config/deploy-targets.json');

export function loadDeployTargets() {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function getDeployTarget(environment) {
  const targets = loadDeployTargets();
  const target = targets[environment];

  if (!target) {
    const knownTargets = Object.keys(targets).sort().join(', ');
    throw new Error(`Unknown deploy target "${environment}". Expected one of: ${knownTargets}`);
  }

  return target;
}

function toOutputKey(field) {
  return field.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function printUsage() {
  console.error('Usage:');
  console.error('  node scripts/deploy-targets.mjs get <environment> <field>');
  console.error('  node scripts/deploy-targets.mjs outputs <environment>');
}

function main() {
  const [command, environment, field] = process.argv.slice(2);

  if (!command || !environment) {
    printUsage();
    process.exit(1);
  }

  const target = getDeployTarget(environment);

  if (command === 'get') {
    if (!field) {
      printUsage();
      process.exit(1);
    }

    if (!(field in target)) {
      const knownFields = Object.keys(target).sort().join(', ');
      throw new Error(
        `Unknown field "${field}" for ${environment}. Expected one of: ${knownFields}`
      );
    }

    process.stdout.write(`${target[field]}\n`);
    return;
  }

  if (command === 'outputs') {
    process.stdout.write(`environment=${environment}\n`);
    for (const [targetField, value] of Object.entries(target)) {
      process.stdout.write(`${toOutputKey(targetField)}=${value}\n`);
    }
    return;
  }

  printUsage();
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  main();
}
