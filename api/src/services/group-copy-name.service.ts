import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { sanitizeSlug } from '../openpath/slug.js';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

function trimSlugEdges(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

function buildNameCandidate(params: { base: string; suffix: string; maxLength: number }): string {
  const maxBaseLength = Math.max(0, params.maxLength - params.suffix.length);
  const base = params.base.slice(0, maxBaseLength).replace(/-+$/, '');
  return `${base}${params.suffix}`;
}

function fallbackRandomName(params: { fallbackPrefix: string; maxLength: number }): string {
  return `${params.fallbackPrefix}-${nanoid(8)}`.slice(0, params.maxLength);
}

export async function findAvailableName(params: {
  baseName: string;
  maxLength: number;
  fallbackPrefix: string;
  exists: (candidate: string) => Promise<boolean>;
}): Promise<string> {
  const safeBase = sanitizeSlug(params.baseName);
  const trimmedBase = trimSlugEdges(safeBase);
  if (!trimmedBase) {
    return fallbackRandomName({
      fallbackPrefix: params.fallbackPrefix,
      maxLength: params.maxLength,
    });
  }

  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const suffix = i === 0 ? '' : `-${String(i + 1)}`;
    const candidate = buildNameCandidate({
      base: trimmedBase,
      suffix,
      maxLength: params.maxLength,
    });
    if (!candidate || candidate.startsWith('-')) {
      return fallbackRandomName({
        fallbackPrefix: params.fallbackPrefix,
        maxLength: params.maxLength,
      });
    }
    if (!(await params.exists(candidate))) return candidate;
  }

  const fallback = buildNameCandidate({
    base: trimmedBase,
    suffix: `-${nanoid(6)}`,
    maxLength: params.maxLength,
  });
  return (
    fallback ||
    fallbackRandomName({ fallbackPrefix: params.fallbackPrefix, maxLength: params.maxLength })
  );
}

export async function findAvailableTemplateName(baseName: string): Promise<string> {
  return findAvailableName({
    baseName,
    maxLength: 100,
    fallbackPrefix: 'template',
    exists: async (candidate) => {
      const rows = await db
        .select({ id: schema.cpGroupTemplates.id })
        .from(schema.cpGroupTemplates)
        .where(eq(schema.cpGroupTemplates.name, candidate))
        .limit(1);
      return rows.length > 0;
    },
  });
}
