import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { openpathDb, requests, whitelistGroups } from '../src/db/openpath.js';
import {
  deleteRequestById,
  findPendingRequestIdByDomain,
  insertRequest,
  resolveRequest,
} from '../src/db/openpath-repos/requests.repo.js';
import { startOpenPathNotifyCapture } from './helpers/openpath-notify.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
// The physical `requests` table enforces group_id NOT NULL + a whitelist_groups
// FK (schema.sql), stricter than the nullable Drizzle mirror type. Seed a real
// group so inserts satisfy that constraint -- same pattern as
// whitelist-rules.repo.test.ts.
const GROUP_ID = `req_repo_group_${RUN_ID}`;
const createdRequestIds = new Set<string>();

before(async () => {
  await openpathDb.insert(whitelistGroups).values({
    id: GROUP_ID,
    name: `requests-repo-${RUN_ID}`.slice(0, 100),
    displayName: 'Requests Repo Test Group',
    enabled: 1,
  });
});

after(async () => {
  if (createdRequestIds.size > 0) {
    await openpathDb.delete(requests).where(inArray(requests.id, [...createdRequestIds]));
  }
  await openpathDb.delete(whitelistGroups).where(eq(whitelistGroups.id, GROUP_ID));
});

describe('requests.repo', () => {
  it('insertRequest returns the created row; findPendingRequestIdByDomain is case-insensitive', async () => {
    const id = `req_${RUN_ID}_1`;
    createdRequestIds.add(id);

    const created = await insertRequest({
      id,
      domain: `pending-${RUN_ID}.example`,
      reason: 'characterization',
      requesterEmail: 'repo-test@test.local',
      groupId: GROUP_ID,
      status: 'pending',
    });
    assert.equal(created?.id, id);

    const found = await findPendingRequestIdByDomain(`PENDING-${RUN_ID}.EXAMPLE`);
    assert.equal(found, id);
  });

  it('resolveRequest stamps the full resolution column set and emits NO openpath event', async () => {
    const id = `req_${RUN_ID}_2`;
    createdRequestIds.add(id);
    await insertRequest({
      id,
      domain: `resolve-${RUN_ID}.example`,
      reason: 'characterization',
      requesterEmail: 'repo-test@test.local',
      groupId: GROUP_ID,
      status: 'pending',
    });

    const capture = await startOpenPathNotifyCapture();
    try {
      await resolveRequest(id, {
        status: 'approved',
        resolvedBy: 'Repo Tester',
        resolutionNote: 'Approved from tenant gateway',
      });

      const [row] = await openpathDb.select().from(requests).where(eq(requests.id, id));
      assert.equal(row.status, 'approved');
      assert.equal(row.resolvedBy, 'Repo Tester');
      assert.equal(row.resolutionNote, 'Approved from tenant gateway');
      assert.ok(row.resolvedAt, 'resolvedAt stamped');
      assert.ok(row.updatedAt, 'updatedAt stamped');

      const events = await capture.waitForCount(1, 500);
      assert.equal(events.length, 0, 'request resolution has no notify pairing (F5), by design');
    } finally {
      await capture.stop();
    }
  });

  it('deleteRequestById removes the row', async () => {
    const id = `req_${RUN_ID}_3`;
    await insertRequest({
      id,
      domain: `delete-${RUN_ID}.example`,
      reason: 'characterization',
      requesterEmail: 'repo-test@test.local',
      groupId: GROUP_ID,
      status: 'pending',
    });
    await deleteRequestById(id);
    const rows = await openpathDb.select().from(requests).where(eq(requests.id, id));
    assert.equal(rows.length, 0);
  });
});
