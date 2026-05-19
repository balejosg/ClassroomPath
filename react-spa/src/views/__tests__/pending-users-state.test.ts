import { describe, expect, it } from 'vitest';

import { translateClassroomPathText } from '../../i18n/classroompath-i18n';
import { formatPendingUserDate, getPendingUsersSummaryLabel } from '../pending-users-state';

describe('pending-users-state', () => {
  it('formats pending user dates and falls back for unknown values', () => {
    expect(formatPendingUserDate(null)).toBe('Unknown date');
    expect(formatPendingUserDate('2026-03-08T12:00:00.000Z')).toContain('2026');
    expect(formatPendingUserDate('2026-03-08T12:00:00.000Z', undefined, 'es')).toMatch(/mar/);
  });

  it('builds a localized summary label', () => {
    expect(getPendingUsersSummaryLabel(1)).toBe('1 pending request');
    expect(getPendingUsersSummaryLabel(2)).toBe('2 pending requests');
  });

  it('formats Spanish summary labels without suffix-based plurals', () => {
    const t = translateClassroomPathText.bind(null, 'es');

    expect(getPendingUsersSummaryLabel(1, t)).toBe('1 solicitud pendiente');
    expect(getPendingUsersSummaryLabel(2, t)).toBe('2 solicitudes pendientes');
  });
});
