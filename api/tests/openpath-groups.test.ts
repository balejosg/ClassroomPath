import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import { inArray } from 'drizzle-orm';

import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { getGroupDisplayNamesByIds } from '../src/db/openpath-repos/groups.repo.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const createdGroupIds = new Set<string>();
let counter = 0;

function nextGroup(params: { baseName: string; displayName: string }): {
  id: string;
  name: string;
  displayName: string;
} {
  counter += 1;
  return {
    id: `opg_${RUN_ID}_${counter}`,
    name: `${params.baseName}-${RUN_ID}-${counter}`.slice(0, 100),
    displayName: params.displayName,
  };
}

async function seedGroup(params: { baseName: string; displayName: string }): Promise<{
  id: string;
  name: string;
}> {
  const group = nextGroup(params);
  createdGroupIds.add(group.id);

  await openpathDb.insert(openpathSchema.whitelistGroups).values({
    id: group.id,
    name: group.name,
    displayName: group.displayName,
    enabled: 1,
  });

  return {
    id: group.id,
    name: group.name,
  };
}

after(async () => {
  const groupIds = [...createdGroupIds];
  if (groupIds.length === 0) {
    return;
  }

  await openpathDb
    .delete(openpathSchema.whitelistGroups)
    .where(inArray(openpathSchema.whitelistGroups.id, groupIds));
});

describe('openpath-groups', () => {
  it('returns readable display names and falls back to the stored name when needed', async () => {
    const visibleGroup = await seedGroup({
      baseName: 'visible-group',
      displayName: 'Visible Group',
    });
    const fallbackGroup = await seedGroup({
      baseName: 'fallback-group',
      displayName: '   ',
    });

    const namesById = await getGroupDisplayNamesByIds([
      '',
      '   ',
      visibleGroup.id,
      fallbackGroup.id,
      visibleGroup.id,
      'missing-group',
    ]);

    assert.strictEqual(namesById.size, 2);
    assert.strictEqual(namesById.get(visibleGroup.id), 'Visible Group');
    assert.strictEqual(namesById.get(fallbackGroup.id), fallbackGroup.name);
    assert.strictEqual(namesById.has('missing-group'), false);
  });

  it('returns an empty map when no usable ids are provided', async () => {
    const namesById = await getGroupDisplayNamesByIds(['', '   ']);
    assert.strictEqual(namesById.size, 0);
  });
});
