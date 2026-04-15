import { desc, eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import type { BillingEntitlementSummaryDto } from './billing-types.js';
import { toEntitlementSummaryDto } from './billing-store.js';

export async function listOrganizationEntitlements(): Promise<BillingEntitlementSummaryDto[]> {
  const rows = await db
    .select({
      organizationId: schema.cpOrganizationEntitlements.organizationId,
      organizationName: schema.cpOrganizations.name,
      source: schema.cpOrganizationEntitlements.source,
      status: schema.cpOrganizationEntitlements.status,
      productKind: schema.cpOrganizationEntitlements.productKind,
      classroomLimit: schema.cpOrganizationEntitlements.classroomLimit,
      currentPeriodEnd: schema.cpOrganizationEntitlements.currentPeriodEnd,
      graceEndsAt: schema.cpOrganizationEntitlements.graceEndsAt,
      cancelAtPeriodEnd: schema.cpOrganizationEntitlements.cancelAtPeriodEnd,
      expiresAt: schema.cpOrganizationEntitlements.expiresAt,
      updatedAt: schema.cpOrganizationEntitlements.updatedAt,
    })
    .from(schema.cpOrganizationEntitlements)
    .innerJoin(
      schema.cpOrganizations,
      eq(schema.cpOrganizationEntitlements.organizationId, schema.cpOrganizations.id)
    )
    .orderBy(desc(schema.cpOrganizationEntitlements.updatedAt));

  return rows.map(toEntitlementSummaryDto);
}
