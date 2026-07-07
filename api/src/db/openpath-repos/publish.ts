import { eq } from 'drizzle-orm';

import { notifyOpenPathEvent, openpathDb, whitelistGroups } from '../openpath.js';

// The mandatory side-effect half of every OpenPath mirror write that changes
// agent-facing policy: OpenPath's API LISTENs on the openpath_events channel,
// and agents poll whitelist_groups.updated_at for freshness. A mirror write
// without its publish strands agents on stale policy. This module co-locates
// the primitives with the repository layer that owns the writes
// (api/src/db/openpath-repos/); repo write methods call these internally
// wherever the pairing is unconditional or derived from the write result.
// Cross-system ledger workflows (ADR 0001) sequence publish as its own
// resumable step and call these directly.

export async function notifyOpenPathGroupChanged(groupId: string): Promise<void> {
  await notifyOpenPathEvent({ type: 'group', groupId });
}

export async function notifyOpenPathClassroomChanged(classroomId: string): Promise<void> {
  await notifyOpenPathEvent({ type: 'classroom', classroomId });
}

export async function touchWhitelistGroupUpdatedAt(groupId: string): Promise<void> {
  await openpathDb
    .update(whitelistGroups)
    .set({ updatedAt: new Date() })
    .where(eq(whitelistGroups.id, groupId));
}

export async function publishWhitelistGroupChanged(groupId: string): Promise<void> {
  await touchWhitelistGroupUpdatedAt(groupId);
  await notifyOpenPathGroupChanged(groupId);
}

export async function publishWhitelistGroupsChanged(groupIds: readonly string[]): Promise<void> {
  const unique = [...new Set(groupIds)];
  await Promise.all(unique.map((groupId) => touchWhitelistGroupUpdatedAt(groupId)));
  await Promise.all(unique.map((groupId) => notifyOpenPathGroupChanged(groupId)));
}
