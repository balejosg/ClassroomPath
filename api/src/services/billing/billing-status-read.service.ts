import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { db, schema } from '../../db/index.js';
import type { BillingStatusDto } from './billing-types.js';
import { toBillingStatusDto } from './billing-utils.js';

export async function getOrganizationBillingStatus(
  organizationId: string
): Promise<BillingStatusDto> {
  const [entitlement] = await db
    .select()
    .from(schema.cpOrganizationEntitlements)
    .where(eq(schema.cpOrganizationEntitlements.organizationId, organizationId))
    .limit(1);

  return toBillingStatusDto(entitlement ?? null);
}

export async function assertOrganizationEntitled(organizationId: string): Promise<void> {
  const status = await getOrganizationBillingStatus(organizationId);
  if (!status.hasActiveEntitlement) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Active billing required' });
  }
}
