import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';

const GROUP_SCOPE_PREFIX = 'cpg';

export function normalizeGroupKey(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function scopedGroupNameForOrg(organizationId: string, publicName: string): string {
  const normalized = normalizeGroupKey(publicName);

  if (!normalized) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Group name must include at least one letter or number',
    });
  }

  const orgHash = createHash('sha256').update(organizationId).digest('hex').slice(0, 10);
  const nameHash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  const prefix = `${GROUP_SCOPE_PREFIX}-${orgHash}-`;
  const suffix = `-${nameHash}`;
  const maxBaseLength = Math.max(1, 100 - prefix.length - suffix.length);
  const base = normalized.slice(0, maxBaseLength);

  return `${prefix}${base}${suffix}`;
}
