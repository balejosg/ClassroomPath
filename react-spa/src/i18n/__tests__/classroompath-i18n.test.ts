import { describe, expect, it } from 'vitest';

import {
  classroomPathI18nCatalogs,
  resolveClassroomPathLocale,
  translateClassroomPathText,
} from '../classroompath-i18n';

/**
 * Returns a diff object for two flat-key catalogs.
 * The ClassroomPath catalog is a flat Record<string, string> so "nesting" is
 * represented by dot-delimited key names, not actual object nesting.
 */
function flatCatalogDiff(
  a: Record<string, string>,
  b: Record<string, string>
): { missingInB: string[]; missingInA: string[] } {
  const keysA = new Set(Object.keys(a));
  const keysB = new Set(Object.keys(b));
  return {
    missingInB: [...keysA].filter((k) => !keysB.has(k)).sort(),
    missingInA: [...keysB].filter((k) => !keysA.has(k)).sort(),
  };
}

describe('classroompath-i18n', () => {
  it('keeps English and Spanish resource keys in parity', () => {
    const { missingInB: missingInEs, missingInA: missingInEn } = flatCatalogDiff(
      classroomPathI18nCatalogs.en as Record<string, string>,
      classroomPathI18nCatalogs.es as Record<string, string>
    );

    expect(missingInEs, `Keys present in EN but missing in ES:\n${missingInEs.join('\n')}`).toEqual(
      []
    );
    expect(missingInEn, `Keys present in ES but missing in EN:\n${missingInEn.join('\n')}`).toEqual(
      []
    );
  });

  it('uses browser-style locale resolution and defaults unsupported locales to English', () => {
    expect(resolveClassroomPathLocale('es-ES')).toBe('es');
    expect(resolveClassroomPathLocale(['fr-FR', 'en-US'])).toBe('en');
    expect(resolveClassroomPathLocale('ca-ES')).toBe('en');
  });

  it('formats ClassroomPath text in the requested locale', () => {
    expect(
      translateClassroomPathText('en', 'app.title.rules.group', { groupName: 'Science' })
    ).toBe('Rules: Science');
    expect(
      translateClassroomPathText('es', 'app.title.rules.group', { groupName: 'Ciencias' })
    ).toBe('Reglas: Ciencias');
  });

  it('uses a consistent Spanish catalog term for entitlement labels', () => {
    const spanishValues = Object.entries(classroomPathI18nCatalogs.es)
      .filter(([key]) => key.includes('entitlement'))
      .map(([, value]) => value);

    expect(spanishValues.length).toBeGreaterThan(0);
    expect(spanishValues.join(' ')).not.toMatch(/Entitlement/i);
    expect(spanishValues.join(' ')).toMatch(/derecho/i);
  });
});
