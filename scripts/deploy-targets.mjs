/**
 * Library and CLI for resolving named deploy targets (staging, production) to their public URLs and configuration.
 *
 * Invoked by: Imported by many scripts and tests; CLI used in npm scripts such as `npm run test:e2e:auth-email:staging`.
 * Usage: node scripts/deploy-targets.mjs get <staging|production> <field>
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');
const publicConfigPath = resolve(projectRoot, 'config/deploy-targets.json');
const localConfigPath = resolve(projectRoot, 'config/deploy-targets.local.json');
const explicitConfigPath = process.env.CLASSROOMPATH_DEPLOY_TARGETS_FILE
  ? resolve(projectRoot, process.env.CLASSROOMPATH_DEPLOY_TARGETS_FILE)
  : '';

export function loadDeployTargets() {
  const configPath =
    explicitConfigPath || (existsSync(localConfigPath) ? localConfigPath : publicConfigPath);
  const targets = JSON.parse(readFileSync(configPath, 'utf8'));
  applyDeployTargetEnvironmentOverrides(targets);
  return targets;
}

function envOverrideName(environment, field) {
  return `CLASSROOMPATH_${environment}_${toOutputKey(field)}`.toUpperCase();
}

function applyDeployTargetEnvironmentOverrides(targets) {
  for (const [environment, target] of Object.entries(targets)) {
    for (const field of Object.keys(target)) {
      const value = process.env[envOverrideName(environment, field)];
      if (value) {
        target[field] = value;
      }
    }
  }
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

function isPlaceholderValue(value) {
  return typeof value === 'string' && value.includes('.invalid');
}

export function assertDeployTargetReady(environment, target, fields = Object.keys(target)) {
  const placeholderFields = Object.entries(target)
    .filter(([field]) => fields.includes(field))
    .filter(([, value]) => isPlaceholderValue(value))
    .map(([field]) => field);

  if (
    placeholderFields.length > 0 &&
    process.env.CLASSROOMPATH_DEPLOY_TARGETS_ALLOW_EXAMPLE !== '1'
  ) {
    throw new Error(
      `Deploy target "${environment}" uses placeholder .invalid values in ${placeholderFields.join(
        ', '
      )}. Create config/deploy-targets.local.json or set CLASSROOMPATH_DEPLOY_TARGETS_FILE to a private config file.`
    );
  }
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

    assertDeployTargetReady(environment, target, [field]);
    process.stdout.write(`${target[field]}\n`);
    return;
  }

  if (command === 'outputs') {
    assertDeployTargetReady(environment, target);
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
