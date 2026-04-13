import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ContactForm } from '../ContactForm';

describe('ContactForm', () => {
  // Stub window.open so mailto doesn't try to navigate in jsdom
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    openSpy.mockRestore();
    vi.useRealTimers();
  });

  it('renders all required fields', () => {
    render(<ContactForm />);

    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Centro educativo')).toBeInTheDocument();
    expect(screen.getByLabelText('Email de contacto')).toBeInTheDocument();
    expect(screen.getByLabelText('Nº de aulas (opcional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Responsable técnico (opcional)')).toBeInTheDocument();
    expect(screen.getByLabelText('¿Necesitáis partner de implantación?')).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<ContactForm />);

    expect(screen.getByLabelText('Qué necesitas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar solicitud/i })).toBeInTheDocument();
  });

  it('updates field values when the user types', () => {
    render(<ContactForm />);

    const nameInput = screen.getByLabelText('Nombre') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Ana García' } });
    expect(nameInput.value).toBe('Ana García');

    const emailInput = screen.getByLabelText('Email de contacto') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'ana@ies.es' } });
    expect(emailInput.value).toBe('ana@ies.es');
  });

  it('shows "Enviando…" state and then transitions to "sent" on submit', async () => {
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Centro educativo'), { target: { value: 'IES Test' } });
    fireEvent.change(screen.getByLabelText('Email de contacto'), {
      target: { value: 'ana@ies.es' },
    });

    fireEvent.change(screen.getByLabelText('Qué necesitas'), {
      target: { value: 'Activación remota' },
    });

    const form = screen.getByRole('button', { name: /Enviar solicitud/i }).closest('form');
    fireEvent.submit(form!);

    // While the 400ms timeout is pending, button should be disabled
    expect(screen.getByRole('button', { name: /Enviando/i })).toBeDisabled();

    // Advance timers so the setTimeout fires, wrapped in act to flush React state updates
    await act(async () => {
      vi.runAllTimers();
    });

    // After the timeout, window.open should have been called with a mailto URL
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('subject=Solicitud%20ClassroomPath'),
      '_self'
    );

    // The "sent" confirmation panel should appear
    expect(screen.getByText('¡Solicitud enviada!')).toBeInTheDocument();
  });

  it('returns to idle when "Enviar otra solicitud" is clicked', async () => {
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Centro educativo'), { target: { value: 'IES Test' } });
    fireEvent.change(screen.getByLabelText('Email de contacto'), {
      target: { value: 'ana@ies.es' },
    });

    const form = screen.getByRole('button', { name: /Enviar solicitud/i }).closest('form');
    fireEvent.submit(form!);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByText('¡Solicitud enviada!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar otra solicitud' }));

    // Should go back to the idle form
    expect(screen.getByRole('button', { name: /Enviar solicitud/i })).toBeInTheDocument();
  });
});
