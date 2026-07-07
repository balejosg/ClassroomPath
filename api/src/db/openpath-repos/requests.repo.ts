import { and, eq, sql } from 'drizzle-orm';

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
