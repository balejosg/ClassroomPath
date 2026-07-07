import { TRPCError } from '@trpc/server';

import { updateUserReturning } from '../db/openpath-repos/users.repo.js';
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

  const updated = await updateUserReturning(params.userId, updateData);

  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
  }

  return (
    (await presentOrganizationUserById(updated.id)) ??
    presentUserWithRoles({
      user: updated,
      roles: [],
    })
  );
}
