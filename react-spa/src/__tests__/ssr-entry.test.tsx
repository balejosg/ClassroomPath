import { describe, expect, it } from 'vitest';

import { renderPublicPage } from '../ssr-entry';

describe('renderPublicPage', () => {
  it('renders metadata and HTML for landing', () => {
    const rendered = renderPublicPage('/');

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/');
    expect(rendered?.title).toBe('Filtrado web escolar por aula | ClassroomPath');
    expect(rendered?.description).toBe(
      'Controla qué se abre y qué se bloquea en cada aula. Servicio gestionado sobre OpenPath, precio por aula y activación remota con el IT del centro.'
    );
    expect(rendered?.appHtml).toContain('Decide qué Internet entra en cada aula');
  });

  it('renders metadata and HTML for pricing', () => {
    const rendered = renderPublicPage('/pricing');

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/pricing');
    expect(rendered?.title).toBe('Precios de filtrado web escolar por aula | ClassroomPath');
    expect(rendered?.description).toBe(
      'Calcula el coste de ClassroomPath por número de aulas. Precio público, onboarding separado, activación remota ligera y servicio gestionado sobre OpenPath.'
    );
    expect(rendered?.appHtml).toContain('Calcula el primer año en segundos');
  });

  it('returns null for non-public SSR routes', () => {
    expect(renderPublicPage('/login')).toBeNull();
  });
});
