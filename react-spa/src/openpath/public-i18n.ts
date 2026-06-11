/**
 * Re-export bridge for the OpenPath public-i18n surface.
 *
 * This file is the ClassroomPath wrapper's single point of contact for i18n
 * providers, hooks, and types from upstream OpenPath. Do NOT edit
 * upstream/openpath/ for wrapper work. To extend or add new locale keys, do so
 * in ClassroomPath's own i18n layer -- never inside the submodule.
 *
 * Boundary doc: docs/contracts/openpath-public-surface.md
 */
export {
  OpenPathI18nProvider,
  SUPPORTED_PRODUCT_LOCALES,
  productI18nCatalogs,
  resolveProductLocale,
  translateProductText,
  useOpenPathI18n,
  useT,
  type ProductI18nKey,
  type ProductI18nParams,
  type ProductLocale,
  type ProductT,
} from '@openpath/public-i18n';
