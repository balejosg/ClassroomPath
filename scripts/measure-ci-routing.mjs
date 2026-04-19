import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { detectCiRelevantChanges } from './detect-ci-relevant-changes.mjs';

const LANE_OUTPUTS = [
  ['product_validation', 'product-validation'],
  ['ops_regression', 'ops-regression'],
  ['release_automation', 'release-automation'],
];

function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object') {
    throw new Error('CI routing samples must be objects');
  }

  const name = String(sample.name ?? '').trim();
  if (!name) {
    throw new Error('CI routing samples must include a non-empty name');
  }

  if (!Array.isArray(sample.files)) {
    throw new Error(`CI routing sample ${name} must include a files array`);
  }

  const files = sample.files.map((filePath) => String(filePath).trim()).filter(Boolean);
  if (files.length === 0) {
    throw new Error(`CI routing sample ${name} must include at least one changed file`);
  }

  return { name, files };
}

export function buildCiRoutingMeasurement(samples) {
  return samples.map((rawSample) => {
    const sample = normalizeSample(rawSample);
    const outputs = detectCiRelevantChanges(sample.files);
    const lanes = LANE_OUTPUTS.filter(([outputName]) => outputs[outputName] === 'true').map(
      ([, laneName]) => laneName
    );

    return {
      ...sample,
      lanes,
      outputs,
    };
  });
}

function readSamplesFile(samplesFile) {
  if (!samplesFile) {
    throw new Error('Usage: node scripts/measure-ci-routing.mjs <samples.json>');
  }

  const parsed = JSON.parse(readFileSync(resolve(samplesFile), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('CI routing samples file must contain a JSON array');
  }

  return parsed;
}

function main(argv = process.argv.slice(2)) {
  const measurements = buildCiRoutingMeasurement(readSamplesFile(argv[0]));
  process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
