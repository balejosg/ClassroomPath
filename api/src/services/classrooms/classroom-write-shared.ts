import { TRPCError } from '@trpc/server';

import type { MachineExemptionRow } from '../../db/openpath-repos/machine-exemptions.repo.js';
import { assertCanUseGroup, assertOrgGroupAccess } from '../../lib/tenant-access.js';

export type ClassroomWriteContext = Parameters<typeof assertCanUseGroup>[0];

export interface CreateClassroomInput {
  name: string;
  displayName?: string;
  defaultGroupId?: string;
  captivePortalDomains?: string[];
}

export interface UpdateClassroomInput {
  id: string;
  displayName?: string;
  defaultGroupId?: string;
  captivePortalDomains?: string[];
}

export interface CreateClassroomExemptionInput {
  machineId: string;
  classroomId: string;
  scheduleId: string;
  groupId?: string | null;
}

export interface CreateOperationalClassroomExemptionInput {
  machineId: string;
  classroomId: string;
  durationHours: number;
  reason: string;
}

export interface DeleteClassroomMachineInput {
  id: string;
  classroomId: string;
}

export async function assertUsableGroupIfProvided(
  ctx: ClassroomWriteContext,
  groupId: string | null | undefined
): Promise<void> {
  if (!groupId) return;

  await assertOrgGroupAccess(ctx.organizationId!, groupId);
  await assertCanUseGroup(ctx, groupId);
}

export function presentClassroomExemption(row: MachineExemptionRow) {
  return {
    id: row.id,
    machineId: row.machineId,
    classroomId: row.classroomId,
    scheduleId: row.scheduleId,
    groupId: row.groupId ?? null,
    source: row.source === 'operational' ? 'operational' : 'schedule',
    reason: row.reason ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export function assertClassroomWriteInputName(name: string): string {
  const publicName = name.trim();
  if (!publicName) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Classroom name is required' });
  }

  return publicName;
}

const MAX_CAPTIVE_PORTAL_DOMAINS = 10;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeCaptivePortalDomains(domains: readonly string[] | undefined): string[] {
  if (domains === undefined) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawDomain of domains) {
    const domain = rawDomain.trim().toLowerCase();
    if (!domain) {
      continue;
    }
    if (/^https?:\/\//.test(domain) || domain.includes('/')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Captive portal entries must be domains, not URLs',
      });
    }
    if (domain.includes('*')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Wildcard captive portal domains are not allowed',
      });
    }

    const labels = domain.split('.');
    const validDomain =
      domain.length <= 253 &&
      labels.length >= 2 &&
      labels.every((label) => DOMAIN_LABEL_PATTERN.test(label));

    if (!validDomain) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid captive portal domain: ${rawDomain}`,
      });
    }

    if (!seen.has(domain)) {
      seen.add(domain);
      normalized.push(domain);
    }
  }

  if (normalized.length > MAX_CAPTIVE_PORTAL_DOMAINS) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'At most 10 captive portal domains are allowed',
    });
  }

  return normalized;
}
