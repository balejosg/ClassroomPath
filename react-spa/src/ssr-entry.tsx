import React from 'react';
import { renderToString } from 'react-dom/server';

import { normalizePathname } from './app/classroom-path-auth-routing';
import { ClassroomPathLandingPage } from './views/Landing';
import { ClassroomPathPricingPage } from './views/Pricing';

type PublicPageMetadata = {
  appHtml: string;
  canonicalPath: '/' | '/pricing';
  description: string;
  title: string;
};

const NOOP = () => {};

export function renderPublicPage(pathname: string): PublicPageMetadata | null {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === '/') {
    return {
      appHtml: renderToString(<ClassroomPathLandingPage onNavigateToLogin={NOOP} />),
      canonicalPath: '/',
      description:
        'ClassroomPath ayuda a los centros educativos a gestionar Internet con criterio, menos ruido digital y una operacion simple basada en software libre.',
      title: 'ClassroomPath | Internet intencional para centros educativos',
    };
  }

  if (normalizedPathname === '/pricing') {
    return {
      appHtml: renderToString(<ClassroomPathPricingPage onNavigateToLogin={NOOP} />),
      canonicalPath: '/pricing',
      description:
        'Consulta los precios de ClassroomPath por aula, pilotos disponibles y el alcance del servicio gestionado sobre OpenPath.',
      title: 'Precios | ClassroomPath',
    };
  }

  return null;
}
