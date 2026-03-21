import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FaqAccordion } from '../FaqAccordion';
import type { FaqItem } from '../../data/faqs';

const ITEMS: FaqItem[] = [
  { q: '¿Primera pregunta?', a: 'Primera respuesta.' },
  { q: '¿Segunda pregunta?', a: 'Segunda respuesta.' },
];

describe('FaqAccordion', () => {
  it('renders all questions', () => {
    render(<FaqAccordion items={ITEMS} />);

    expect(screen.getByText('¿Primera pregunta?')).toBeInTheDocument();
    expect(screen.getByText('¿Segunda pregunta?')).toBeInTheDocument();
  });

  it('expands an item when its button is clicked', () => {
    render(<FaqAccordion items={ITEMS} />);

    const btn = screen.getByRole('button', { name: '¿Primera pregunta?' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Primera respuesta.')).toBeInTheDocument();
  });

  it('collapses an open item when clicked again', () => {
    render(<FaqAccordion items={ITEMS} />);

    const btn = screen.getByRole('button', { name: '¿Primera pregunta?' });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses custom section labels when provided', () => {
    render(
      <FaqAccordion
        items={ITEMS}
        sectionLabel="Sección personalizada"
        sectionTitle="Título personalizado"
      />
    );

    expect(screen.getByText('Sección personalizada')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Título personalizado' })).toBeInTheDocument();
  });
});
