import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GroupLibrary } from '../GroupLibrary';

const mockInvalidate = vi.fn(async () => undefined);

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    useUtils: vi.fn(() => ({
      groups: {
        list: { invalidate: mockInvalidate },
        libraryList: { invalidate: mockInvalidate },
      },
      templates: {
        list: { invalidate: mockInvalidate },
      },
    })),
    groups: {
      libraryList: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false })),
      },
      list: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false })),
      },
      listRulesPaginated: {
        useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
      },
      clone: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      update: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
    },
    templates: {
      list: {
        useQuery: vi.fn(() => ({ data: [], isLoading: false })),
      },
      listRulesPaginated: {
        useQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
      },
      import: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      publishFromGroup: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
    },
  },
}));

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('GroupLibrary', () => {
  it('opens and closes the library modal for teachers', () => {
    renderWithQueryClient(<GroupLibrary userRole="teacher" />);

    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));
    expect(screen.getByRole('heading', { name: /biblioteca de politicas/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(
      screen.queryByRole('heading', { name: /biblioteca de politicas/i })
    ).not.toBeInTheDocument();
  });
});
