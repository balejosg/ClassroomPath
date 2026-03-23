import { describe, expect, it } from 'vitest';

import { renderPublicPage } from '../ssr-entry';

describe('renderPublicPage', () => {
  it('renders metadata and HTML for landing', () => {
    const rendered = renderPublicPage('/');

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/');
    expect(rendered?.title).toContain('ClassroomPath');
    expect(rendered?.appHtml).toContain('La forma serena de gestionar Internet');
  });

  it('renders metadata and HTML for pricing', () => {
    const rendered = renderPublicPage('/pricing');

    expect(rendered).not.toBeNull();
    expect(rendered?.canonicalPath).toBe('/pricing');
    expect(rendered?.title).toContain('Precios');
    expect(rendered?.appHtml).toContain('Precios simples por aula');
  });

  it('returns null for non-public SSR routes', () => {
    expect(renderPublicPage('/login')).toBeNull();
  });
});
