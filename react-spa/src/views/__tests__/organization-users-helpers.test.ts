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
        status: 'Activo',
      },
      {
        kind: 'member',
        id: 'user-2',
        name: 'Student User',
        email: 'student@example.com',
        role: 'user',
        status: 'Inactivo',
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
        status: 'Pendiente',
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
        status: 'Pendiente',
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
        invitationUrl: 'https://example.com/invite',
      })
    ).toEqual({
      tone: 'success',
      title: 'Invitación enviada',
      description: 'Se envió la invitación a ada@example.com.',
    });

    expect(
      getDeliveryNoticeFromInvitationResult({
        email: 'ada@example.com',
        emailSent: false,
        invitationUrl: 'https://example.com/invite',
      })
    ).toEqual({
      tone: 'warning',
      title: 'Invitación creada sin correo',
      description:
        'Resend no está configurado o no pudo enviar el correo. Comparte este enlace con ada@example.com.',
      url: 'https://example.com/invite',
    });

    expect(
      getDeliveryNoticeFromResetResult({
        email: 'admin@example.com',
        emailSent: true,
        resetUrl: 'https://example.com/reset',
      })
    ).toEqual({
      tone: 'success',
      title: 'Enlace de recuperación enviado',
      description: 'Se envió un correo de recuperación a admin@example.com.',
    });

    expect(
      getDeliveryNoticeFromResetResult({
        email: 'admin@example.com',
        emailSent: false,
        resetUrl: 'https://example.com/reset',
      })
    ).toEqual({
      tone: 'warning',
      title: 'Recuperación generada sin correo',
      description: 'Resend no envió el correo. Comparte este enlace con admin@example.com.',
      url: 'https://example.com/reset',
    });
  });

  it('returns stable labels and initials for table rows', () => {
    expect(getPrimaryRoleLabel([{ role: 'admin' }])).toBe('admin');
    expect(getPrimaryRoleLabel([{ role: 'teacher' }])).toBe('teacher');
    expect(getPrimaryRoleLabel([{ role: 'student' }])).toBe('user');

    expect(getRoleLabel('admin')).toBe('Administrador');
    expect(getRoleLabel('teacher')).toBe('Profesor');
    expect(getRoleLabel('user')).toBe('Usuario');

    expect(getRowInitials('Ada Lovelace')).toBe('AL');
    expect(getRowInitials('')).toBe('??');
  });

  it('computes the table summary label from the filtered row count', () => {
    expect(getSummaryLabel(0)).toBe('Mostrando 0-0 de 0 usuarios');
    expect(getSummaryLabel(3)).toBe('Mostrando 1-3 de 3 usuarios');
  });
});
