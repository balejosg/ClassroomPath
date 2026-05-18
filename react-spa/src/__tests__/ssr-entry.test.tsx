import { describe, expect, it } from 'vitest';

import { renderPublicPage } from '../ssr-entry';

describe('renderPublicPage', () => {
  it('renders metadata and HTML for landing', () => {
    const rendered = renderPublicPage({ pathname: '/', locale: 'en-US' });

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/');
    expect(rendered?.lang).toBe('en');
    expect(rendered?.hydrationLocale).toBe('en');
    expect(rendered?.title).toBe('Classroom web filtering | ClassroomPath');
    expect(rendered?.description).toBe(
      'Control what opens and what gets blocked in each classroom. Managed service on OpenPath, classroom-based pricing, and remote activation with the school IT team.'
    );
    expect(rendered?.appHtml).toContain('Decide what Internet reaches each classroom');
  });

  it('renders metadata and HTML for pricing', () => {
    const rendered = renderPublicPage({ pathname: '/pricing', locale: 'es-ES' });

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/pricing');
    expect(rendered?.lang).toBe('es');
    expect(rendered?.title).toBe('Precios de filtrado web escolar por aula | ClassroomPath');
    expect(rendered?.description).toBe(
      'Calcula el coste de ClassroomPath por número de aulas. Precio público, onboarding separado, activación remota ligera y servicio gestionado sobre OpenPath.'
    );
    expect(rendered?.appHtml).toContain('Calcula el primer año en segundos');
  });

  it('returns null for non-public SSR routes', () => {
    expect(renderPublicPage({ pathname: '/login', locale: 'en' })).toBeNull();
  });
});
