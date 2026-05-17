import React from 'react';
import { renderToString } from 'react-dom/server';

import { normalizePathname } from './app/classroom-path-auth-routing';
import { ClassroomPathLandingPage } from './views/Landing';
import { ClassroomPathPricingPage } from './views/Pricing';
import {
  ClassroomPathI18nProvider,
  resolveClassroomPathLocale,
  translateClassroomPathText,
} from './i18n/classroompath-i18n';
import type { ProductLocale } from './openpath/public-i18n';

type PublicPageMetadata = {
  appHtml: string;
  canonicalPath: '/' | '/pricing';
  description: string;
  hydrationLocale: ProductLocale;
  lang: ProductLocale;
  title: string;
};

type RenderPublicPageInput =
  | string
  | {
      pathname: string;
      locale?: string | readonly string[] | null;
    };

const NOOP = () => {};

function renderWithLocale(children: React.ReactNode, locale: ProductLocale): string {
  return renderToString(
    <ClassroomPathI18nProvider locale={locale}>{children}</ClassroomPathI18nProvider>
  );
}

export function renderPublicPage(input: RenderPublicPageInput): PublicPageMetadata | null {
  const pathname = typeof input === 'string' ? input : input.pathname;
  const locale = resolveClassroomPathLocale(typeof input === 'string' ? null : input.locale);
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === '/') {
    return {
      appHtml: renderWithLocale(<ClassroomPathLandingPage onNavigateToLogin={NOOP} />, locale),
      canonicalPath: '/',
      description: translateClassroomPathText(locale, 'public.landing.description'),
      hydrationLocale: locale,
      lang: locale,
      title: translateClassroomPathText(locale, 'public.landing.title'),
    };
  }

  if (normalizedPathname === '/pricing') {
    return {
      appHtml: renderWithLocale(<ClassroomPathPricingPage onNavigateToLogin={NOOP} />, locale),
      canonicalPath: '/pricing',
      description: translateClassroomPathText(locale, 'public.pricing.description'),
      hydrationLocale: locale,
      lang: locale,
      title: translateClassroomPathText(locale, 'public.pricing.title'),
    };
  }

  return null;
}
