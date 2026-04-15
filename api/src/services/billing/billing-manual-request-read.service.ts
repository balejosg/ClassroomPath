import { desc } from 'drizzle-orm';

import { db, schema } from '../../db/index.js';
import type { ManualBillingRequestDto } from './billing-types.js';
import { toManualBillingRequestDto } from './billing-store.js';

export async function listManualBillingRequests(): Promise<ManualBillingRequestDto[]> {
  const rows = await db
    .select()
    .from(schema.cpBillingManualRequests)
    .orderBy(desc(schema.cpBillingManualRequests.createdAt));

  return rows.map(toManualBillingRequestDto);
}
