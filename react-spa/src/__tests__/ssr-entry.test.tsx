import { describe, expect, it } from 'vitest';

import { renderPublicPage } from '../ssr-entry';

describe('renderPublicPage', () => {
  it('renders metadata and HTML for landing', () => {
    const rendered = renderPublicPage('/');

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/');
    expect(rendered?.title).toContain('Filtrado web escolar');
    expect(rendered?.description).toContain('control de acceso por aula');
    expect(rendered?.appHtml).toContain('Controla el acceso a Internet por aula');
  });

  it('renders metadata and HTML for pricing', () => {
    const rendered = renderPublicPage('/pricing');

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/pricing');
    expect(rendered?.title).toContain('Precios por aula');
    expect(rendered?.description).toContain('piloto');
    expect(rendered?.appHtml).toContain('Calcula el coste por aula');
  });

  it('returns null for non-public SSR routes', () => {
    expect(renderPublicPage('/login')).toBeNull();
  });
});
