import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pure source-text contract test: no DB connection, no drizzle runtime.
//
// ClassroomPath re-declares (mirrors) OpenPath's `machine_exemptions` table in
// api/src/db/openpath.ts and writes exemptions directly to the shared DB. When
// OpenPath adds a column to that table (e.g. `group_id`), CP's mirror can
// silently lack it and SaaS teachers won't get the feature. This test parses
// both schema files as text and asserts every OpenPath column is also
// declared in CP's mirror.

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const projectRoot = dirname(apiDir);

const OPENPATH_SCHEMA_PATH = resolve(projectRoot, 'upstream/openpath/api/src/db/schema.ts');
const CP_MIRROR_PATH = resolve(projectRoot, 'api/src/db/openpath.ts');

// drizzle-orm/pg-core column builder functions. Only calls to these functions
// carry a DB column name as their first argument; everything else
// (.references(), .default(...), sql`` templates, index/constraint names)
// must be ignored so it isn't mistaken for a column name.
const COLUMN_BUILDER_NAMES = [
  'varchar',
  'text',
  'timestamp',
  'boolean',
  'integer',
  'uuid',
  'time',
  'serial',
  'bigserial',
  'smallserial',
  'bigint',
  'numeric',
  'decimal',
  'date',
  'smallint',
  'real',
  'doublePrecision',
  'json',
  'jsonb',
  'char',
  'point',
  'line',
  'interval',
  'bytea',
  'cidr',
  'inet',
  'macaddr',
];

/**
 * Finds the index of the bracket matching the one at `openIndex`, skipping
 * over the contents of string/template literals so unrelated parens/braces
 * inside quoted text (sql`` templates, default values, etc.) don't throw off
 * the balance count.
 */
function findMatchingBracket(text: string, openIndex: number): number {
  const openChar = text[openIndex];
  const closeChar = openChar === '(' ? ')' : openChar === '{' ? '}' : null;
  if (!closeChar) {
    throw new Error(`Unsupported bracket character: ${openChar}`);
  }

  let depth = 0;
  let i = openIndex;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }

    i++;
  }

  throw new Error(`No matching '${closeChar}' found for '${openChar}' at index ${openIndex}`);
}

/**
 * Extracts the raw text of a `pgTable('tableName', { ...columns... }, ...)`
 * call's column-definitions object (the first `{ ... }` argument), given the
 * full source text of a Drizzle schema file.
 */
function extractPgTableColumnsBlock(source: string, tableName: string): string {
  const callRegex = new RegExp(`pgTable\\(\\s*['"]${tableName}['"]`);
  const callMatch = callRegex.exec(source);
  if (!callMatch) {
    throw new Error(`Could not find pgTable('${tableName}', ...) declaration`);
  }

  const openParenIndex = source.indexOf('(', callMatch.index);
  const openBraceIndex = source.indexOf('{', openParenIndex);
  const closeBraceIndex = findMatchingBracket(source, openBraceIndex);

  return source.slice(openBraceIndex, closeBraceIndex + 1);
}

/**
 * Extracts the snake_case DB column names declared inside a Drizzle
 * column-defs block, e.g. `machineId: varchar('machine_id', ...)` ->
 * 'machine_id'. Robust to multiline formatting and inline comments since it
 * only looks for `<builderFn>('<name>'` occurrences.
 */
function extractColumnNames(columnsBlock: string): string[] {
  const builderPattern = new RegExp(
    `\\b(?:${COLUMN_BUILDER_NAMES.join('|')})\\(\\s*['"]([a-zA-Z][a-zA-Z0-9_]*)['"]`,
    'g'
  );

  const columns: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = builderPattern.exec(columnsBlock)) !== null) {
    columns.push(match[1]);
  }

  return columns;
}

function extractMachineExemptionsColumns(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const columnsBlock = extractPgTableColumnsBlock(source, 'machine_exemptions');
  return extractColumnNames(columnsBlock);
}

function findMissingColumns(sourceColumns: string[], mirrorColumns: string[]): string[] {
  const mirrorSet = new Set(mirrorColumns);
  return sourceColumns.filter((column) => !mirrorSet.has(column));
}

void describe('openpath machine_exemptions schema mirror contract', () => {
  const openpathColumns = extractMachineExemptionsColumns(OPENPATH_SCHEMA_PATH);
  const cpMirrorColumns = extractMachineExemptionsColumns(CP_MIRROR_PATH);

  void it('parses a non-empty column set from both schema files', () => {
    assert.ok(
      openpathColumns.length > 0,
      'Expected to parse at least one column from upstream OpenPath machine_exemptions'
    );
    assert.ok(
      cpMirrorColumns.length > 0,
      'Expected to parse at least one column from the ClassroomPath machine_exemptions mirror'
    );
  });

  void it('parses the columns known to exist on machine_exemptions', () => {
    for (const expected of ['machine_id', 'group_id', 'source', 'expires_at']) {
      assert.ok(
        openpathColumns.includes(expected),
        `Expected OpenPath machine_exemptions columns to include '${expected}', got: ${openpathColumns.join(', ')}`
      );
      assert.ok(
        cpMirrorColumns.includes(expected),
        `Expected ClassroomPath machine_exemptions mirror columns to include '${expected}', got: ${cpMirrorColumns.join(', ')}`
      );
    }
  });

  void it('self-check: the comparison helper flags a column dropped from the mirror', () => {
    const mirrorWithoutGroupId = cpMirrorColumns.filter((column) => column !== 'group_id');
    const missing = findMissingColumns(openpathColumns, mirrorWithoutGroupId);

    assert.deepStrictEqual(
      missing,
      ['group_id'],
      'Sanity check: findMissingColumns should flag a column removed from the mirror'
    );
  });

  void it('every OpenPath machine_exemptions column exists in the ClassroomPath mirror', () => {
    const missing = findMissingColumns(openpathColumns, cpMirrorColumns);

    assert.deepStrictEqual(
      missing,
      [],
      `ClassroomPath's machine_exemptions mirror (api/src/db/openpath.ts) is missing column(s) ` +
        `present in OpenPath's source of truth (upstream/openpath/api/src/db/schema.ts): ` +
        `${missing.join(', ')}. Add the missing column(s) to CP's mirror so SaaS teachers get the feature.`
    );
  });
});
