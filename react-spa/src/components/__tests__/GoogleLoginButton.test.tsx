import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import GoogleLoginButton from '../GoogleLoginButton';

const mockFetch = vi.fn();
const mockInitialize = vi.fn();
const mockRenderButton = vi.fn();
const mockPrompt = vi.fn();
const mockReportError = vi.fn();

vi.mock('../../lib/reportError', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);

    window.google = {
      accounts: {
        id: {
          initialize: mockInitialize,
          renderButton: mockRenderButton,
          prompt: mockPrompt,
        },
      },
    } as typeof window.google;

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ googleClientId: 'client-id-123' }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
    delete window.google;
  });

  it('renders the Google button once config and SDK are ready', async () => {
    mockRenderButton.mockImplementation((element: HTMLElement) => {
      element.appendChild(document.createElement('iframe'));
    });

    render(<GoogleLoginButton onSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledTimes(1);
      expect(mockRenderButton).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('google-signin-btn').childElementCount).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /reintentar google/i })).not.toBeInTheDocument();
  });

  it('keeps the rendered Google button visible across parent re-renders', async () => {
    mockRenderButton.mockImplementation((element: HTMLElement) => {
      element.appendChild(document.createElement('iframe'));
    });

    const { rerender } = render(<GoogleLoginButton onSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledTimes(1);
      expect(mockRenderButton).toHaveBeenCalledTimes(1);
    });

    for (let renderCount = 0; renderCount < 10; renderCount += 1) {
      rerender(<GoogleLoginButton onSuccess={vi.fn()} />);
    }

    await waitFor(() => {
      expect(screen.getByTestId('google-signin-btn')).not.toHaveClass('opacity-0');
    });

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRenderButton).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('google-signin-btn').childElementCount).toBeGreaterThan(0);
  });

  it('retries rendering when Google does not paint the button on the first attempt', async () => {
    mockRenderButton
      .mockImplementationOnce(() => {})
      .mockImplementation((element: HTMLElement) => {
        element.appendChild(document.createElement('iframe'));
      });

    render(<GoogleLoginButton onSuccess={vi.fn()} />);

    await waitFor(
      () => {
        expect(mockRenderButton).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 }
    );
  });

  it('shows a retry action when Google never renders the button and recovers on retry', async () => {
    mockRenderButton.mockImplementation(() => {});

    render(<GoogleLoginButton onSuccess={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: /reintentar google/i }, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalled();

    mockRenderButton.mockImplementation((element: HTMLElement) => {
      element.appendChild(document.createElement('iframe'));
    });

    fireEvent.click(screen.getByRole('button', { name: /reintentar google/i }));

    await waitFor(
      () => {
        expect(screen.getByTestId('google-signin-btn').childElementCount).toBeGreaterThan(0);
      },
      { timeout: 3000 }
    );
  });

  it('surfaces bootstrap failures when the runtime config request fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    render(<GoogleLoginButton onSuccess={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: /reintentar google/i }, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalledWith(
      'Failed to prepare Google login button',
      expect.any(Error),
      expect.objectContaining({ action: 'google-button-bootstrap' })
    );
  });

  it('surfaces render exceptions and keeps the retry action available', async () => {
    mockRenderButton.mockImplementation(() => {
      throw new Error('render exploded');
    });

    render(<GoogleLoginButton onSuccess={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: /reintentar google/i }, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(mockReportError).toHaveBeenCalledWith(
      'Failed to render Google login button',
      expect.any(Error),
      expect.objectContaining({ action: 'google-button-render' })
    );
  });
});
