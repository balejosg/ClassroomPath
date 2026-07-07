import { getUsersByIds } from '../db/openpath-repos/users.repo.js';
import { presentUserRole, presentUserWithRoles } from './presenters.js';
import {
  assertOrganizationUserAccess,
  getOrganizationUserIds,
  getRolesByUserId,
} from './organization-user-access.service.js';
import { getPersistedUserRole, presentOrganizationUserById } from './organization-user-helpers.js';

export async function listOrganizationUsers(organizationId: string) {
  const userIds = await getOrganizationUserIds({ organizationId });
  if (userIds.length === 0) return [];

  const [usersList, rolesByUserId] = await Promise.all([
    getUsersByIds(userIds),
    getRolesByUserId(userIds),
  ]);
  const nowIso = new Date().toISOString();

  return usersList.map((user) =>
    presentUserWithRoles({
      user,
      roles: rolesByUserId.get(user.id) ?? [],
      nowIso,
    })
  );
}

export async function getOrganizationUserById(params: { organizationId: string; userId: string }) {
  await assertOrganizationUserAccess(params);
  return presentOrganizationUserById(params.userId);
}

export async function getOrganizationUserRole(params: { organizationId: string; userId: string }) {
  await assertOrganizationUserAccess(params);

  const role = await getPersistedUserRole(params.userId);

  if (!role) return null;

  return presentUserRole({
    role,
    fallback: {
      userId: params.userId,
      role: role.role,
      groupIds: role.groupIds,
      createdBy: role.createdBy ?? undefined,
    },
  });
}
