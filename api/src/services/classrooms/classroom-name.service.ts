import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';

const CLASSROOM_SCOPE_PREFIX = 'cp';

export function normalizeClassroomKey(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function scopedClassroomNameForOrg(organizationId: string, publicName: string): string {
  const normalized = normalizeClassroomKey(publicName);

  if (!normalized) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Classroom name must include at least one letter or number',
    });
  }

  const orgHash = createHash('sha256').update(organizationId).digest('hex').slice(0, 10);
  const nameHash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  const prefix = `${CLASSROOM_SCOPE_PREFIX}-${orgHash}-`;
  const suffix = `-${nameHash}`;
  const maxBaseLength = Math.max(1, 100 - prefix.length - suffix.length);
  const base = normalized.slice(0, maxBaseLength);

  return `${prefix}${base}${suffix}`;
}
