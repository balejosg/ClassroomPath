import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GroupLibrary } from '../GroupLibrary';

const mockInvalidate = vi.fn(async () => undefined);
const mockCloneMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockImportMutate = vi.fn();
const mockPublishMutate = vi.fn();

let libraryGroups: Array<Record<string, unknown>> = [];
let orgGroups: Array<Record<string, unknown>> = [];
let templates: Array<Record<string, unknown>> = [];
let groupRules = { data: undefined, isLoading: false };
let templateRules = { data: undefined, isLoading: false };

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
        useQuery: vi.fn(() => ({ data: libraryGroups, isLoading: false })),
      },
      list: {
        useQuery: vi.fn(() => ({ data: orgGroups, isLoading: false })),
      },
      listRulesPaginated: {
        useQuery: vi.fn(() => groupRules),
      },
      clone: {
        useMutation: vi.fn(() => ({ mutate: mockCloneMutate, isPending: false })),
      },
      update: {
        useMutation: vi.fn(() => ({ mutate: mockUpdateMutate, isPending: false })),
      },
    },
    templates: {
      list: {
        useQuery: vi.fn(() => ({ data: templates, isLoading: false })),
      },
      listRulesPaginated: {
        useQuery: vi.fn(() => templateRules),
      },
      import: {
        useMutation: vi.fn(() => ({ mutate: mockImportMutate, isPending: false })),
      },
      publishFromGroup: {
        useMutation: vi.fn(() => ({ mutate: mockPublishMutate, isPending: false })),
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
  beforeEach(() => {
    vi.clearAllMocks();
    libraryGroups = [];
    orgGroups = [];
    templates = [];
    groupRules = { data: undefined, isLoading: false };
    templateRules = { data: undefined, isLoading: false };
  });

  it('opens and closes the library modal for teachers', () => {
    renderWithQueryClient(<GroupLibrary userRole="teacher" />);

    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));
    expect(
      screen.getByRole('heading', { name: /biblioteca de pol\u00edticas/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(
      screen.queryByRole('heading', { name: /biblioteca de pol\u00edticas/i })
    ).not.toBeInTheDocument();
  });

  it('clones a library policy from the teacher-facing tab', () => {
    libraryGroups = [
      {
        id: 'group-1',
        name: 'math',
        displayName: 'Math Policy',
        whitelistCount: 2,
        blockedSubdomainCount: 1,
        blockedPathCount: 0,
      },
    ];

    renderWithQueryClient(<GroupLibrary userRole="teacher" />);

    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Clonar' }));

    expect(mockCloneMutate).toHaveBeenCalledWith({ sourceGroupId: 'group-1' });
  });

  it('lets admins change visibility and publish templates from the manage tab', () => {
    orgGroups = [
      {
        id: 'group-2',
        name: 'science',
        displayName: 'Science Policy',
        visibility: 'private',
        whitelistCount: 1,
        blockedSubdomainCount: 1,
        blockedPathCount: 1,
      },
    ];

    renderWithQueryClient(<GroupLibrary userRole="admin" />);

    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar' }));
    fireEvent.change(screen.getByDisplayValue('Privada'), {
      target: { value: 'instance_public' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar plantilla' }));

    expect(mockUpdateMutate).toHaveBeenCalledWith({
      id: 'group-2',
      visibility: 'instance_public',
    });
    expect(mockPublishMutate).toHaveBeenCalledWith({
      groupId: 'group-2',
      name: 'science',
      displayName: 'Science Policy',
    });
  });
});
