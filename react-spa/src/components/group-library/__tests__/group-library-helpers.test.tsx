import { describe, expect, it } from 'vitest';

import {
  filterGroupLibraryItems,
  getGroupLibraryDomainCount,
  getRulesPreviewCopy,
  normalizeGroupLibrarySearch,
} from '../group-library-helpers';
import { translateClassroomPathText, type ClassroomPathT } from '../../../i18n/classroompath-i18n';

const tEs: ClassroomPathT = (key, params) => translateClassroomPathText('es', key, params);

describe('group-library-helpers', () => {
  it('normalizes search by trimming and lowercasing', () => {
    expect(normalizeGroupLibrarySearch('  Math Policy  ')).toBe('math policy');
  });

  it('filters items using a normalized haystack', () => {
    const items = [
      { id: '1', displayName: 'Math Policy', name: 'math-policy' },
      { id: '2', displayName: 'Science Policy', name: 'science-policy' },
    ];

    expect(
      filterGroupLibraryItems(items, '  science  ', (item) => `${item.displayName} ${item.name}`)
    ).toEqual([items[1]]);
  });

  it('returns all items when the search is blank', () => {
    const items = [{ id: '1' }, { id: '2' }];

    expect(filterGroupLibraryItems(items, '   ', () => '')).toEqual(items);
  });

  it('computes the visible domain count for a group', () => {
    expect(
      getGroupLibraryDomainCount({
        whitelistCount: 2,
        blockedSubdomainCount: 3,
        blockedPathCount: 4,
      })
    ).toBe(9);
  });

  it('returns the correct preview copy for groups and templates', () => {
    expect(getRulesPreviewCopy('group', tEs)).toEqual({
      title: 'Vista previa (solo lectura)',
      subtitle: 'Puedes clonar para editar.',
      primaryActionLabel: 'Clonar',
    });

    expect(getRulesPreviewCopy('template', tEs)).toEqual({
      title: 'Vista previa de plantilla',
      subtitle: 'Puedes importar para editar.',
      primaryActionLabel: 'Importar',
    });
  });
});
