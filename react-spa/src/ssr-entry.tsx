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
        'Filtrado web escolar con control de acceso por aula para dispositivos institucionales, onboarding guiado y operacion gestionada.',
      title: 'Filtrado web escolar por aula | ClassroomPath',
    };
  }

  if (normalizedPathname === '/pricing') {
    return {
      appHtml: renderToString(<ClassroomPathPricingPage onNavigateToLogin={NOOP} />),
      canonicalPath: '/pricing',
      description:
        'Consulta precios por aula, onboarding y piloto de ClassroomPath para desplegar control de acceso escolar con criterio.',
      title: 'Precios por aula y piloto | ClassroomPath',
    };
  }

  return null;
}
