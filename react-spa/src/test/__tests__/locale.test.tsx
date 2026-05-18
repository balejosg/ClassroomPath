import { afterEach, describe, expect, it } from 'vitest';

import { clearClassroomPathTestLocale, setClassroomPathTestLocale } from '../locale';

describe('ClassroomPath test locale helpers', () => {
  afterEach(() => {
    clearClassroomPathTestLocale();
  });

  it('sets and clears the hydrated ClassroomPath locale for a test', () => {
    setClassroomPathTestLocale('es');

    expect(document.documentElement.dataset.classroompathLocale).toBe('es');

    clearClassroomPathTestLocale();

    expect(document.documentElement.dataset.classroompathLocale).toBeUndefined();
  });
});
