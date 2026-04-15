import { describe, expect, it } from 'vitest';

import { formatPendingUserDate, getPendingUsersSummaryLabel } from '../pending-users-state';

describe('pending-users-state', () => {
  it('formats pending user dates and falls back for unknown values', () => {
    expect(formatPendingUserDate(null)).toBe('Fecha desconocida');
    expect(formatPendingUserDate('2026-03-08T12:00:00.000Z')).toContain('2026');
  });

  it('builds a localized summary label', () => {
    expect(getPendingUsersSummaryLabel(1)).toBe('1 solicitud pendiente');
    expect(getPendingUsersSummaryLabel(2)).toBe('2 solicitudes pendientes');
  });
});
