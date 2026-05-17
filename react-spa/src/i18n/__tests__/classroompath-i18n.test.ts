import { describe, expect, it } from 'vitest';

import {
  classroomPathI18nCatalogs,
  resolveClassroomPathLocale,
  translateClassroomPathText,
} from '../classroompath-i18n';

describe('classroompath-i18n', () => {
  it('keeps English and Spanish resource keys in parity', () => {
    expect(Object.keys(classroomPathI18nCatalogs.es).sort()).toEqual(
      Object.keys(classroomPathI18nCatalogs.en).sort()
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
});
