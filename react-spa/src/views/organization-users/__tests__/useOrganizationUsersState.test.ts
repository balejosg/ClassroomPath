import { describe, expect, it } from 'vitest';

import { buildOrganizationUsersQueryState, toRevokeTarget } from '../useOrganizationUsersState';

describe('useOrganizationUsersState helpers', () => {
  it('maps table rows into revoke targets', () => {
    expect(
      toRevokeTarget({
        kind: 'invitation',
        id: 'inv-1',
        name: 'Invited User',
        email: 'invite@example.com',
        role: 'teacher',
        status: 'pending',
        expiresAt: '2026-03-12T10:00:00.000Z',
      })
    ).toEqual({
      kind: 'invitation',
      id: 'inv-1',
      name: 'Invited User',
      email: 'invite@example.com',
    });
  });

  it('derives filtered rows, summary and query status from query payloads', () => {
    const state = buildOrganizationUsersQueryState({
      users: [
        {
          id: 'user-1',
          name: 'Ada Admin',
          email: 'ada@example.com',
          isActive: true,
          roles: [{ role: 'admin' }],
        },
      ],
      invitations: [
        {
          id: 'inv-1',
          name: 'Turing Teacher',
          email: 'turing@example.com',
          role: 'teacher',
          expiresAt: '2026-03-12T10:00:00.000Z',
        },
      ],
      searchQuery: 'turing',
      usersLoading: false,
      invitationsLoading: false,
      usersError: null,
      invitationsError: null,
      usersErrored: false,
      invitationsErrored: false,
    });

    expect(state.filteredRows).toHaveLength(1);
    expect(state.summaryLabel).toContain('1');
    expect(state.isInitialLoading).toBe(false);
    expect(state.hasQueryError).toBe(false);
  });
});
