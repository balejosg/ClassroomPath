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

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('School')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact email')).toBeInTheDocument();
    expect(screen.getByLabelText('Classrooms (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Technical owner (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Do you need an implementation partner?')).toBeInTheDocument();
  });

  it('renders the submit button', () => {
    render(<ContactForm />);

    expect(screen.getByLabelText('What do you need?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send request/i })).toBeInTheDocument();
  });

  it('updates field values when the user types', () => {
    render(<ContactForm />);

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Ana García' } });
    expect(nameInput.value).toBe('Ana García');

    const emailInput = screen.getByLabelText('Contact email') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'ana@ies.es' } });
    expect(emailInput.value).toBe('ana@ies.es');
  });

  it('shows "Enviando…" state and then transitions to "sent" on submit', async () => {
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('School'), { target: { value: 'IES Test' } });
    fireEvent.change(screen.getByLabelText('Contact email'), {
      target: { value: 'ana@ies.es' },
    });

    fireEvent.change(screen.getByLabelText('What do you need?'), {
      target: { value: 'remoteActivation' },
    });

    const form = screen.getByRole('button', { name: /Send request/i }).closest('form');
    fireEvent.submit(form!);

    // While the 400ms timeout is pending, button should be disabled
    expect(screen.getByRole('button', { name: /Sending/i })).toBeDisabled();

    // Advance timers so the setTimeout fires, wrapped in act to flush React state updates
    await act(async () => {
      vi.runAllTimers();
    });

    // After the timeout, window.open should have been called with a mailto URL
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('subject=ClassroomPath%20request'),
      '_self'
    );

    // The "sent" confirmation panel should appear
    expect(screen.getByText('Request sent')).toBeInTheDocument();
  });

  it('returns to idle when "Enviar otra solicitud" is clicked', async () => {
    render(<ContactForm />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('School'), { target: { value: 'IES Test' } });
    fireEvent.change(screen.getByLabelText('Contact email'), {
      target: { value: 'ana@ies.es' },
    });

    const form = screen.getByRole('button', { name: /Send request/i }).closest('form');
    fireEvent.submit(form!);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByText('Request sent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send another request' }));

    // Should go back to the idle form
    expect(screen.getByRole('button', { name: /Send request/i })).toBeInTheDocument();
  });
});
