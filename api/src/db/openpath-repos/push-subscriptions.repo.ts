import { eq, sql } from 'drizzle-orm';

import { openpathDb, pushSubscriptions } from '../openpath.js';

// Owning module for push_subscriptions access. No notify pairing (F5).
// replaceSubscriptionByEndpoint preserves the pre-refactor delete-then-insert
// WITHOUT a transaction (plan F13(c)). Ownership (userId) is supplied by the
// calling service from its tenant/user context -- never derived here.

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;

export async function replaceSubscriptionByEndpoint(values: NewPushSubscription): Promise<void> {
  await openpathDb.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, values.endpoint));

  await openpathDb.insert(pushSubscriptions).values(values);
}

export async function getSubscriptionsByUserId(userId: string): Promise<PushSubscriptionRow[]> {
  return openpathDb.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

export async function getSubscriptionsForGroup(groupId: string): Promise<PushSubscriptionRow[]> {
  return openpathDb
    .select()
    .from(pushSubscriptions)
    .where(sql`${pushSubscriptions.groupIds} @> ARRAY[${groupId}]::text[]`);
}

export async function deleteSubscriptionOwnedBy(params: {
  userId: string;
  endpoint?: string;
  subscriptionId?: string;
}): Promise<Array<{ id: string }>> {
  const predicate = params.endpoint
    ? eq(pushSubscriptions.endpoint, params.endpoint)
    : eq(pushSubscriptions.id, params.subscriptionId ?? '');

  return openpathDb
    .delete(pushSubscriptions)
    .where(sql`${pushSubscriptions.userId} = ${params.userId} AND ${predicate}`)
    .returning({ id: pushSubscriptions.id });
}

export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await openpathDb.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}
