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
        'Controla qué se abre y qué se bloquea en cada aula. Servicio gestionado sobre OpenPath, precio por aula y activación remota con el IT del centro.',
      title: 'Filtrado web escolar por aula | ClassroomPath',
    };
  }

  if (normalizedPathname === '/pricing') {
    return {
      appHtml: renderToString(<ClassroomPathPricingPage onNavigateToLogin={NOOP} />),
      canonicalPath: '/pricing',
      description:
        'Calcula el coste de ClassroomPath por número de aulas. Precio público, onboarding separado, activación remota ligera y servicio gestionado sobre OpenPath.',
      title: 'Precios de filtrado web escolar por aula | ClassroomPath',
    };
  }

  return null;
}
