import { sql } from 'drizzle-orm';

import { closeConnection, db } from '../src/db/index.js';

type DuplicateMembershipRow = {
  user_id: string;
  membership_count: number | string;
  organization_ids: string[] | null;
};

async function main(): Promise<void> {
  const result = await db.execute<DuplicateMembershipRow>(sql`
    select
      user_id,
      count(*)::int as membership_count,
      array_agg(organization_id order by organization_id) as organization_ids
    from cp_memberships
    group by user_id
    having count(*) > 1
    order by count(*) desc, user_id asc
  `);

  const rows = result.rows ?? [];

  if (rows.length === 0) {
    console.log('No multi-org memberships found. Safe to enforce cp_memberships_user_id_key.');
    return;
  }

  console.error('Found users with memberships in multiple organizations:');
  for (const row of rows) {
    const membershipCount =
      typeof row.membership_count === 'number'
        ? row.membership_count
        : Number.parseInt(String(row.membership_count), 10);
    const organizationIds = Array.isArray(row.organization_ids) ? row.organization_ids : [];
    console.error(
      `- ${row.user_id}: ${String(membershipCount)} memberships [${organizationIds.join(', ')}]`
    );
  }

  process.exitCode = 1;
}

await main().finally(async () => {
  await closeConnection();
});
