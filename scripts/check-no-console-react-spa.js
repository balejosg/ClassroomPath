#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const SRC_DIR = resolve(ROOT_DIR, 'react-spa', 'src');

const ALLOWED_FILES = new Set([resolve(ROOT_DIR, 'react-spa', 'src', 'lib', 'reportError.ts')]);

const EXCLUDED_DIRS = new Set(['__tests__', 'test', 'e2e']);
const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx']);
const CONSOLE_RE = /\bconsole\.[a-zA-Z]+\b/;

function walk(dir, onFile) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, onFile);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = fullPath.slice(fullPath.lastIndexOf('.'));
    if (!INCLUDED_EXTENSIONS.has(extension)) {
      continue;
    }

    onFile(fullPath);
  }
}

function isTestFile(filePath) {
  return /\.(test|spec)\.(ts|tsx)$/.test(filePath);
}

function main() {
  const hits = [];

  walk(SRC_DIR, (filePath) => {
    if (ALLOWED_FILES.has(filePath)) {
      return;
    }

    if (isTestFile(filePath)) {
      return;
    }

    const contents = readFileSync(filePath, 'utf-8');
    const lines = contents.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!CONSOLE_RE.test(line)) {
        continue;
      }

      hits.push({ filePath, lineNumber: i + 1, line: line.trim() });
    }
  });

  if (hits.length === 0) {
    return;
  }

  console.error('ERROR: console.* is not allowed in ClassroomPath react-spa app code.');
  console.error('Allowed only in react-spa/src/lib/reportError.ts and in test files.');
  console.error('');

  const files = new Map();
  for (const hit of hits) {
    const list = files.get(hit.filePath) ?? [];
    list.push(hit);
    files.set(hit.filePath, list);
  }

  for (const [filePath, fileHits] of files) {
    const relativePath = filePath.startsWith(ROOT_DIR)
      ? filePath.slice(ROOT_DIR.length + 1)
      : filePath;

    console.error(relativePath);
    for (const hit of fileHits) {
      console.error(`  L${hit.lineNumber}: ${hit.line}`);
    }
    console.error('');
  }

  process.exit(1);
}

main();
