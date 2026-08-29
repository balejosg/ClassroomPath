import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const volumeSmokePath = resolve(projectRoot, 'scripts/windows-offline-installer-volume-smoke.mjs');

test('fresh-volume installer smoke exercises the real non-root named-volume boundary', () => {
  assert.equal(existsSync(volumeSmokePath), true, 'fresh-volume smoke script must exist');

  const content = readFileSync(volumeSmokePath, 'utf8');
  assert.match(content, /spawn\('docker'/u);
  assert.match(content, /'build',\s*'--file'/u);
  assert.match(content, /\['volume', 'create'/u);
  assert.match(content, /--mount/u);
  assert.match(content, /--user/u);
  assert.match(content, /stat/u);
  assert.match(content, /\['volume', 'rm'/u);
  assert.match(content, /\['image', 'rm'/u);
  assert.doesNotMatch(content, /down\s+-v|volume\s+prune/u);
});
