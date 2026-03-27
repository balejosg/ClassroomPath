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
  if (process.argv[2] !== '--field' || !process.argv[3]) {
    printUsage();
    process.exit(1);
  }

  const field = process.argv[3];
  if (field !== 'extensionId' && field !== 'version') {
    throw new Error(`Unsupported Firefox release metadata field: ${field}`);
  }

  const content = await readStdin();
  process.stdout.write(getFirefoxReleaseMetadataField(content, field));
}

try {
  if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
