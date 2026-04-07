import { stdin } from 'node:process';

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function parseFirefoxReleaseMetadata(content) {
  let parsed;

  try {
    parsed = JSON.parse(String(content ?? ''));
  } catch {
    throw new Error('Firefox release metadata is not valid JSON');
  }

  return {
    extensionId: normalizeNonEmptyString(parsed?.extensionId),
    version: normalizeNonEmptyString(parsed?.version),
  };
}

export function getFirefoxReleaseMetadataField(content, field) {
  const metadata = parseFirefoxReleaseMetadata(content);
  const value = metadata[field];

  if (!value) {
    throw new Error(`Firefox release metadata is missing a valid ${field}`);
  }

  return value;
}

export function getFirefoxReleaseMetadataFieldFromCliArgs(argv, content) {
  if (argv[0] !== '--field' || !argv[1]) {
    throw new Error(
      'Usage:\n  node scripts/read-firefox-release-metadata.mjs --field <extensionId|version> < metadata.json'
    );
  }

  const field = argv[1];
  if (field !== 'extensionId' && field !== 'version') {
    throw new Error(`Unsupported Firefox release metadata field: ${field}`);
  }

  return getFirefoxReleaseMetadataField(content, field);
}

async function readStdin() {
  const chunks = [];

  for await (const chunk of stdin) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }

  return chunks.join('');
}

function printUsage() {
  console.error('Usage:');
  console.error(
    '  node scripts/read-firefox-release-metadata.mjs --field <extensionId|version> < metadata.json'
  );
}

async function main() {
  const content = await readStdin();
  process.stdout.write(getFirefoxReleaseMetadataFieldFromCliArgs(process.argv.slice(2), content));
}

try {
  if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
