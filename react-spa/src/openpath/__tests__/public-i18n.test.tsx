import { describe, expect, it } from 'vitest';

import {
  resolveProductLocale,
  SUPPORTED_PRODUCT_LOCALES,
  translateProductText,
} from '../public-i18n';

describe('@openpath/public-i18n bridge', () => {
  it('re-exports the shared OpenPath product locale helpers', () => {
    expect(SUPPORTED_PRODUCT_LOCALES).toEqual(['en', 'es']);
    expect(resolveProductLocale('es-ES')).toBe('es');
    expect(translateProductText('en', 'sidebar.nav.settings')).toBe('Settings');
  });
});
