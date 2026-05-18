import { describe, expect, it } from 'vitest';

import {
  buildInvitationRows,
  buildMemberRows,
  filterOrganizationUserRows,
  getDeliveryNoticeFromInvitationResult,
  getDeliveryNoticeFromResetResult,
  getPrimaryRoleLabel,
  getRoleLabel,
  getRowInitials,
  getSummaryLabel,
} from '../organization-users-helpers';

describe('organization-users-helpers', () => {
  it('maps member and invitation rows to the organization users table shape', () => {
    expect(
      buildMemberRows([
        {
          id: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          isActive: true,
          roles: [{ role: 'teacher' }],
        },
        {
          id: 'user-2',
          name: 'Student User',
          email: 'student@example.com',
          isActive: false,
          roles: [{ role: 'student' }],
        },
      ])
    ).toEqual([
      {
        kind: 'member',
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'teacher',
        status: 'active',
      },
      {
        kind: 'member',
        id: 'user-2',
        name: 'Student User',
        email: 'student@example.com',
        role: 'user',
        status: 'inactive',
      },
    ]);

    expect(
      buildInvitationRows([
        {
          id: 'inv-1',
          name: 'Grace Hopper',
          email: 'grace@example.com',
          role: 'admin',
          expiresAt: '2026-03-12T10:00:00.000Z',
        },
      ])
    ).toEqual([
      {
        kind: 'invitation',
        id: 'inv-1',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: '2026-03-12T10:00:00.000Z',
      },
    ]);
  });

  it('filters rows by name/email and keeps them sorted by name', () => {
    const rows = filterOrganizationUserRows({
      memberRows: buildMemberRows([
        {
          id: 'user-1',
          name: 'Zoe Admin',
          email: 'zoe@example.com',
          isActive: true,
          roles: [{ role: 'admin' }],
        },
      ]),
      invitationRows: buildInvitationRows([
        {
          id: 'inv-1',
          name: 'Ada Pending',
          email: 'ada@example.com',
          role: 'teacher',
          expiresAt: '2026-03-12T10:00:00.000Z',
        },
      ]),
      searchQuery: 'ada',
    });

    expect(rows).toEqual([
      {
        kind: 'invitation',
        id: 'inv-1',
        name: 'Ada Pending',
        email: 'ada@example.com',
        role: 'teacher',
        status: 'pending',
        expiresAt: '2026-03-12T10:00:00.000Z',
      },
    ]);

    expect(
      filterOrganizationUserRows({
        memberRows: buildMemberRows([
          {
            id: 'user-1',
            name: 'Zoe Admin',
            email: 'zoe@example.com',
            isActive: true,
            roles: [{ role: 'admin' }],
          },
        ]),
        invitationRows: buildInvitationRows([
          {
            id: 'inv-1',
            name: 'Ada Pending',
            email: 'ada@example.com',
            role: 'teacher',
            expiresAt: '2026-03-12T10:00:00.000Z',
          },
        ]),
        searchQuery: '',
      }).map((row) => row.name)
    ).toEqual(['Ada Pending', 'Zoe Admin']);
  });

  it('builds the delivery notices for invites and password resets', () => {
    expect(
      getDeliveryNoticeFromInvitationResult({
        email: 'ada@example.com',
        emailSent: true,
      })
    ).toEqual({
      tone: 'success',
      title: 'Invitation sent',
      description: 'The invitation was sent to ada@example.com.',
    });

    expect(
      getDeliveryNoticeFromInvitationResult({
        email: 'ada@example.com',
        emailSent: false,
      })
    ).toEqual({
      tone: 'warning',
      title: 'Invitation pending delivery',
      description:
        'Could not confirm delivery to ada@example.com. Retry the invitation from this screen.',
    });

    expect(
      getDeliveryNoticeFromResetResult({
        email: 'admin@example.com',
        emailSent: true,
      })
    ).toEqual({
      tone: 'success',
      title: 'Recovery link sent',
      description: 'A recovery email was sent to admin@example.com.',
    });

    expect(
      getDeliveryNoticeFromResetResult({
        email: 'admin@example.com',
        emailSent: false,
      })
    ).toEqual({
      tone: 'warning',
      title: 'Recovery pending delivery',
      description:
        'Could not confirm delivery to admin@example.com. Generate a new recovery email to retry.',
    });
  });

  it('returns stable labels and initials for table rows', () => {
    expect(getPrimaryRoleLabel([{ role: 'admin' }])).toBe('admin');
    expect(getPrimaryRoleLabel([{ role: 'teacher' }])).toBe('teacher');
    expect(getPrimaryRoleLabel([{ role: 'student' }])).toBe('user');

    expect(getRoleLabel('admin')).toBe('Administrator');
    expect(getRoleLabel('teacher')).toBe('Teacher');
    expect(getRoleLabel('user')).toBe('User');

    expect(getRowInitials('Ada Lovelace')).toBe('AL');
    expect(getRowInitials('')).toBe('??');
  });

  it('computes the table summary label from the filtered row count', () => {
    expect(getSummaryLabel(0)).toBe('Showing 0-0 of 0 users');
    expect(getSummaryLabel(3)).toBe('Showing 1-3 of 3 users');
  });
});
