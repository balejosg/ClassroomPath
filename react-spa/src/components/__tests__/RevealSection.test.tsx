import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RevealSection } from '../RevealSection';

describe('RevealSection', () => {
  it('renders its children', () => {
    render(
      <RevealSection>
        <p>Contenido de prueba</p>
      </RevealSection>
    );

    expect(screen.getByText('Contenido de prueba')).toBeInTheDocument();
  });

  it('forwards the id attribute to the section element', () => {
    const { container } = render(
      <RevealSection id="my-section">
        <p>Hello</p>
      </RevealSection>
    );

    expect(container.querySelector('#my-section')).not.toBeNull();
  });

  it('applies the additional className', () => {
    const { container } = render(
      <RevealSection className="bg-slate-50">
        <p>Hello</p>
      </RevealSection>
    );

    // The section should have the extra class merged in
    const section = container.querySelector('section');
    expect(section?.className).toContain('bg-slate-50');
  });
});
