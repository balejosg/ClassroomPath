import { readFileSync } from 'node:fs';

// Shared text-parsing helpers for OpenPath <-> ClassroomPath Drizzle schema-mirror
// contract tests (see api/tests/openpath-schema-mirror.contract.test.ts).
//
// Deliberately text-based, not a runtime import of both schema modules: importing
// api/src/db/openpath.ts executes `new Pool(...)` and `drizzle(pool)` as import-time
// side effects (api/src/db/openpath.ts:23-34), opening a real Postgres connection
// pool just to read table metadata. Parsing both schema files as text avoids that
// side effect entirely -- no database, no env vars, no drizzle-orm runtime
// compatibility needed between the two independently-versioned schema modules.

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
export function findMatchingBracket(text: string, openIndex: number): number {
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
export function extractPgTableColumnsBlock(source: string, tableName: string): string {
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
export function extractColumnNames(columnsBlock: string): string[] {
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

/**
 * Reads a Drizzle schema file from disk and extracts the DB column names
 * declared on the named `pgTable(...)`. Generic over table name so it works
 * for any table declared in either the upstream OpenPath schema or the
 * ClassroomPath mirror -- not just `machine_exemptions`.
 */
export function extractTableColumns(filePath: string, tableName: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const columnsBlock = extractPgTableColumnsBlock(source, tableName);
  return extractColumnNames(columnsBlock);
}

export function findMissingColumns(sourceColumns: string[], mirrorColumns: string[]): string[] {
  const mirrorSet = new Set(mirrorColumns);
  return sourceColumns.filter((column) => !mirrorSet.has(column));
}
