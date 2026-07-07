import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { openpathDb, requests } from '../openpath.js';

// Owning module for requests-table writes. Deliberately publish-free: request
// rows are teacher-workflow state, not agent-facing policy (F5 in the
// 2026-07-06 repository plan). The approve flow's publish belongs to its rule
// insert and lives in whitelist-rules.repo.insertRuleIfAbsentAndPublish.

export type RequestRow = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;

export async function findPendingRequestIdByDomain(domain: string): Promise<string | undefined> {
  const pendingRequest = await openpathDb
    .select({ id: requests.id })
    .from(requests)
    .where(and(sql`LOWER(${requests.domain}) = LOWER(${domain})`, eq(requests.status, 'pending')))
    .limit(1);

  return pendingRequest[0]?.id;
}

export async function getRequestById(requestId: string): Promise<RequestRow | undefined> {
  const rows = await openpathDb.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  return rows[0];
}

export async function getRequestsByGroupIds(groupIds: readonly string[]): Promise<RequestRow[]> {
  if (groupIds.length === 0) {
    return [];
  }
  return openpathDb
    .select()
    .from(requests)
    .where(inArray(requests.groupId, [...groupIds]));
}

export async function listRequestsByGroupIds(params: {
  groupIds: readonly string[];
  status?: 'pending' | 'approved' | 'rejected';
}): Promise<RequestRow[]> {
  if (params.groupIds.length === 0) {
    return [];
  }

  const conditions = [inArray(requests.groupId, [...params.groupIds])];
  if (params.status) {
    conditions.push(eq(requests.status, params.status));
  }

  return openpathDb
    .select()
    .from(requests)
    .where(and(...conditions))
    .orderBy(requests.createdAt);
}

export async function getRecentRequestsForGroup(
  groupId: string,
  limit: number
): Promise<
  Array<
    Pick<
      RequestRow,
      | 'id'
      | 'domain'
      | 'reason'
      | 'status'
      | 'requesterEmail'
      | 'createdAt'
      | 'updatedAt'
      | 'resolvedAt'
      | 'resolvedBy'
      | 'resolutionNote'
    >
  >
> {
  return openpathDb
    .select({
      id: requests.id,
      domain: requests.domain,
      reason: requests.reason,
      status: requests.status,
      requesterEmail: requests.requesterEmail,
      createdAt: requests.createdAt,
      updatedAt: requests.updatedAt,
      resolvedAt: requests.resolvedAt,
      resolvedBy: requests.resolvedBy,
      resolutionNote: requests.resolutionNote,
    })
    .from(requests)
    .where(eq(requests.groupId, groupId))
    .orderBy(desc(requests.createdAt))
    .limit(limit);
}

export async function insertRequest(values: NewRequest): Promise<RequestRow | undefined> {
  const [created] = await openpathDb.insert(requests).values(values).returning();
  return created;
}

export async function resolveRequest(
  requestId: string,
  resolution: {
    status: 'approved' | 'rejected';
    resolvedBy: string;
    resolutionNote: string | null;
  }
): Promise<void> {
  await openpathDb
    .update(requests)
    .set({
      status: resolution.status,
      updatedAt: new Date(),
      resolvedAt: new Date(),
      resolvedBy: resolution.resolvedBy,
      resolutionNote: resolution.resolutionNote,
    })
    .where(eq(requests.id, requestId));
}

export async function deleteRequestById(requestId: string): Promise<void> {
  await openpathDb.delete(requests).where(eq(requests.id, requestId));
}
