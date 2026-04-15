import { eq } from 'drizzle-orm';

import { openpathDb, users } from '../db/openpath.js';
import { presentUserWithRoles } from './presenters.js';
import {
  assertManagedOrganizationUser,
  presentOrganizationUserById,
} from './organization-user-helpers.js';

export async function updateOrganizationUser(params: {
  organizationId: string;
  userId: string;
  name?: string;
  active?: boolean;
}) {
  await assertManagedOrganizationUser(params);

  const updateData: { name?: string; isActive?: boolean } = {};
  if (params.name !== undefined) updateData.name = params.name.trim();
  if (params.active !== undefined) updateData.isActive = params.active;

  const [updated] = await openpathDb
    .update(users)
    .set(updateData)
    .where(eq(users.id, params.userId))
    .returning();

  return (
    (await presentOrganizationUserById(updated.id)) ??
    presentUserWithRoles({
      user: updated,
      roles: [],
    })
  );
}
