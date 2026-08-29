#!/usr/bin/env node

/**
 * Verifies documentation constraints: checks for dead links, non-ASCII characters, and formatting issues across docs/.
 *
 * Invoked by: Developer CLI via `npm run verify:docs`; `docs-verification.test.ts`.
 * Usage: node scripts/verify-docs.mjs [--fix]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const docsIndexPath = 'docs/INDEX.md';
const failures = [];
const spanishMaintainedExceptionPaths = new Set(['docs/evaluation/es/guia-evaluacion-centros.md']);

function listTrackedMarkdownFiles() {
  const result = spawnSync('git', ['ls-files', 'README.md', 'AGENTS.md', 'docs'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const details = result.stderr || result.stdout || 'git ls-files failed';
    throw new Error(details.trim());
  }

  return String(result.stdout ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.endsWith('.md'))
    .filter((entry) => fs.existsSync(path.join(rootDir, entry)));
}

function isSpanishMaintainedException(relativePath) {
  return spanishMaintainedExceptionPaths.has(relativePath);
}

function normalizeLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim().replace(/^<|>$/g, '');
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('app://')
  ) {
    return null;
  }

  return trimmed.split('#')[0].split('?')[0];
}

function toRepoRelative(fromFile, target) {
  const fromDir = path.dirname(path.join(rootDir, fromFile));
  const resolvedPath = path.resolve(fromDir, target);
  return path.relative(rootDir, resolvedPath).replaceAll(path.sep, '/');
}

const markdownFiles = listTrackedMarkdownFiles();

const docsIndexContent = fs.readFileSync(path.join(rootDir, docsIndexPath), 'utf8');
const markdownLinkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
const indexedDocs = new Set();

for (const match of docsIndexContent.matchAll(markdownLinkPattern)) {
  const normalizedTarget = normalizeLinkTarget(match[1]);
  if (!normalizedTarget || !normalizedTarget.endsWith('.md')) {
    continue;
  }

  indexedDocs.add(toRepoRelative(docsIndexPath, normalizedTarget));
}

for (const indexedDoc of indexedDocs) {
  if (indexedDoc.startsWith('docs/plans/') && indexedDoc !== 'docs/plans/README.md') {
    failures.push(`${docsIndexPath}: canonical index must not include draft plan ${indexedDoc}`);
  }

  if (indexedDoc.startsWith('.github/')) {
    failures.push(
      `${docsIndexPath}: canonical index must not include repo-process doc ${indexedDoc}`
    );
  }
}

for (const relativeFile of markdownFiles) {
  const absoluteFile = path.join(rootDir, relativeFile);
  const content = fs.readFileSync(absoluteFile, 'utf8');
  const isSpanishException = isSpanishMaintainedException(relativeFile);
  const isMaintainedDoc =
    content.includes('> Status: maintained') ||
    (isSpanishException && content.includes('> Estado: mantenido'));

  if (relativeFile.endsWith('.es.md')) {
    failures.push(`${relativeFile}: language-specific Markdown files are not allowed`);
  }

  if (!isMaintainedDoc) {
    continue;
  }

  if (isSpanishException) {
    if (!content.includes('> Aplica a:')) {
      failures.push(`${relativeFile}: maintained Spanish doc missing "> Aplica a:" metadata`);
    }

    if (
      !content.includes('> Última verificación:') &&
      !content.includes('> Ultima verificacion:')
    ) {
      failures.push(
        `${relativeFile}: maintained Spanish doc missing "> Última verificación:" metadata`
      );
    }

    if (!content.includes('> Fuente de verdad:')) {
      failures.push(
        `${relativeFile}: maintained Spanish doc missing "> Fuente de verdad:" metadata`
      );
    }
  } else {
    if (!content.includes('> Applies to:')) {
      failures.push(`${relativeFile}: maintained doc missing "> Applies to:" metadata`);
    }

    if (!content.includes('> Last verified:')) {
      failures.push(`${relativeFile}: maintained doc missing "> Last verified:" metadata`);
    }

    if (!content.includes('> Source of truth:')) {
      failures.push(`${relativeFile}: maintained doc missing "> Source of truth:" metadata`);
    }
  }

  if (!isSpanishException && /[^\x00-\x7F]/.test(content)) {
    failures.push(`${relativeFile}: expected ASCII-only English documentation`);
  }

  if (relativeFile.startsWith('docs/plans/') && relativeFile !== 'docs/plans/README.md') {
    failures.push(`${relativeFile}: draft plans must not be marked as maintained`);
  }

  if (relativeFile !== docsIndexPath && !indexedDocs.has(relativeFile)) {
    failures.push(`${relativeFile}: maintained doc is not linked from docs/INDEX.md`);
  }

  for (const match of content.matchAll(markdownLinkPattern)) {
    const normalizedTarget = normalizeLinkTarget(match[1]);
    if (!normalizedTarget) {
      continue;
    }

    const resolvedPath = path.resolve(path.dirname(absoluteFile), normalizedTarget);
    if (!fs.existsSync(resolvedPath)) {
      failures.push(`${relativeFile}: broken link -> ${match[1]}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Documentation verification failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('');
  console.error('How to fix (policy enforced by scripts/verify-docs.mjs):');
  console.error(
    '  broken link                      -> correct or remove the link target in the listed file'
  );
  console.error(
    '  non-ASCII / expected ASCII-only  -> remove non-ASCII characters; use ASCII equivalents or plain English'
  );
  console.error(
    '  maintained doc not in index      -> add a link to the file in docs/INDEX.md, or remove the "> Status: maintained" header'
  );
  console.error(
    '  missing "> Applies to:" etc.     -> add the three required metadata lines (Applies to, Last verified, Source of truth)'
  );
  console.error(
    '  draft plan marked as maintained  -> remove "> Status: maintained" from files under docs/plans/'
  );
  console.error(
    '  index links a draft plan         -> move draft plan links out of docs/INDEX.md (use docs/plans/README.md instead)'
  );
  console.error(
    '  index links a .github/ doc       -> remove the .github/ link from docs/INDEX.md'
  );
  console.error(
    '  language-specific .es.md file    -> rename to a non-language-specific path (e.g. docs/evaluation/es/filename.md)'
  );
  process.exit(1);
}

console.log(`Documentation verification passed for ${markdownFiles.length} Markdown files.`);
