import { eq } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import { getSingleMembershipOrThrow } from '../../lib/tenant-memberships.js';

export async function getExistingBillingOrganization(
  userId: string
): Promise<{ id: string; name: string } | null> {
  const membership = await getSingleMembershipOrThrow(userId);
  if (!membership) return null;

  const [organization] = await db
    .select({
      id: schema.cpOrganizations.id,
      name: schema.cpOrganizations.name,
    })
    .from(schema.cpOrganizations)
    .where(eq(schema.cpOrganizations.id, membership.organizationId))
    .limit(1);

  return {
    id: membership.organizationId,
    name: organization?.name ?? membership.organizationId,
  };
}

export {
  activateExistingOrganizationEntitlement,
  createOrganizationWithEntitlement,
  upsertOrganizationEntitlement,
} from './billing-entitlement-write.service.js';
export {
  findEntitlementByStripeReference,
  updateEntitlementLifecycleFromStripe,
} from './billing-entitlement-lifecycle.service.js';
