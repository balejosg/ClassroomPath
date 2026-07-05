/**
 * Strips `//` line comments and `/* *\/` block comments from source text,
 * while preserving string/template literal contents verbatim (string- and
 * escape-aware, so a `//` or `/*` inside a quoted string is not mistaken for
 * a comment).
 *
 * Source-text contract tests that scan raw file content for forbidden
 * specifiers or required signals rely on this: without stripping comments, a
 * comment or docstring that merely *mentions* a package name, identifier, or
 * type (e.g. a copy-pasted docstring, or `// TODO: scope by organizationId`)
 * reads as a real match and false-positives (or false-passes) the guard. A
 * real `import`/`require`/`from` specifier, or a real type/identifier
 * reference, always lives in code, never only inside a comment, so stripping
 * only comments keeps a guard scoped to genuine matches.
 *
 * Regex literals are also preserved verbatim (escape- and character-class-
 * aware), using the standard prev-token heuristic to tell a regex literal
 * apart from division. Without this, something like `/\/\//` reads its
 * escaped `\/\/` as a `//` line-comment opener and swallows the rest of the
 * line -- including a real match that happens to share that line.
 *
 * Shared by api/tests/workspace-packages.test.ts (OpenPath adapter-boundary
 * checks) and api/tests/tenant-service-guard.contract.test.ts (tenant
 * scoping-signal checks); covered by workspace-packages.test.ts's
 * `describe('stripComments', ...)` suite.
 */
function isRegexLiteralContext(result: string): boolean {
  const trimmed = result.replace(/\s+$/, '');
  if (trimmed.length === 0) return true;

  const lastChar = trimmed[trimmed.length - 1];
  const punctuators = new Set(['=', '(', ',', '[', '!', '&', '|', '?', ':', ';', '{', '}']);
  if (punctuators.has(lastChar)) return true;

  const wordMatch = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(trimmed);
  if (!wordMatch) return false;

  const keywords = new Set([
    'return',
    'typeof',
    'case',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'instanceof',
  ]);
  return keywords.has(wordMatch[0]);
}

export function stripComments(source: string): string {
  let result = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    if (two === '/*') {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      result += ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < n) {
          result += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        result += source[i];
        i++;
      }
      if (i < n) {
        result += source[i];
        i++;
      }
      continue;
    }

    if (ch === '/' && isRegexLiteralContext(result)) {
      result += ch;
      i++;
      let inClass = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\' && i + 1 < n) {
          result += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        if (c === '[') {
          inClass = true;
        } else if (c === ']') {
          inClass = false;
        } else if (c === '/' && !inClass) {
          result += c;
          i++;
          break;
        }
        result += c;
        i++;
      }
      while (i < n && /[a-zA-Z]/.test(source[i])) {
        result += source[i];
        i++;
      }
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
