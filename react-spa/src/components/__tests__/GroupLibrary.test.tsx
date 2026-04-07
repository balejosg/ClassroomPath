import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GroupLibrary } from '../GroupLibrary';
import type { RulesPage } from '../group-library/group-library-helpers';

const mockInvalidate = vi.fn(async () => undefined);
const mockCloneMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockImportMutate = vi.fn();
const mockPublishMutate = vi.fn();

let cloneMutationOptions: { onSuccess?: () => Promise<void> | void } | undefined;
let updateMutationOptions: { onSuccess?: () => Promise<void> | void } | undefined;
let importMutationOptions: { onSuccess?: () => Promise<void> | void } | undefined;
let publishMutationOptions: { onSuccess?: () => Promise<void> | void } | undefined;

let libraryGroups: Array<Record<string, unknown>> = [];
let orgGroups: Array<Record<string, unknown>> = [];
let templates: Array<Record<string, unknown>> = [];
let groupRules: { data: RulesPage | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
let templateRules: { data: RulesPage | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

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
        useMutation: vi.fn((options) => {
          cloneMutationOptions = options;
          return { mutate: mockCloneMutate, isPending: false };
        }),
      },
      update: {
        useMutation: vi.fn((options) => {
          updateMutationOptions = options;
          return { mutate: mockUpdateMutate, isPending: false };
        }),
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
        useMutation: vi.fn((options) => {
          importMutationOptions = options;
          return { mutate: mockImportMutate, isPending: false };
        }),
      },
      publishFromGroup: {
        useMutation: vi.fn((options) => {
          publishMutationOptions = options;
          return { mutate: mockPublishMutate, isPending: false };
        }),
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

  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

describe('GroupLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    libraryGroups = [];
    orgGroups = [];
    templates = [];
    groupRules = { data: undefined, isLoading: false };
    templateRules = { data: undefined, isLoading: false };
    cloneMutationOptions = undefined;
    updateMutationOptions = undefined;
    importMutationOptions = undefined;
    publishMutationOptions = undefined;
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

  it('opens the preview modal for groups, supports pagination, and clones from the preview action', () => {
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
    groupRules = {
      data: {
        total: 60,
        hasMore: true,
        rules: [{ id: 'rule-1', type: 'allow', value: 'math.example.com' }],
      },
      isLoading: false,
    };

    renderWithQueryClient(<GroupLibrary userRole="teacher" />);

    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));

    expect(
      screen.getByRole('heading', { name: /vista previa \(solo lectura\)/i })
    ).toBeInTheDocument();
    expect(screen.getByText('math.example.com')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar dominio...'), {
      target: { value: 'math.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(screen.getByRole('button', { name: 'Anterior' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Clonar' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[1]);

    expect(mockCloneMutate).toHaveBeenCalledWith({ sourceGroupId: 'group-1' });
    expect(
      screen.queryByRole('heading', { name: /vista previa \(solo lectura\)/i })
    ).not.toBeInTheDocument();
  });

  it('opens the template preview and runs mutation invalidations on success', async () => {
    templates = [
      {
        id: 'template-1',
        name: 'starter',
        displayName: 'Starter Template',
        description: 'Base policy',
        ruleCount: 3,
      },
    ];
    templateRules = {
      data: {
        total: 1,
        hasMore: false,
        rules: [{ id: 'rule-2', type: 'allow', value: 'starter.example.com' }],
      },
      isLoading: false,
    };

    const { queryClient } = renderWithQueryClient(<GroupLibrary userRole="admin" />);
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Plantillas' }));
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre...'), {
      target: { value: 'starter' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));

    expect(screen.getByRole('heading', { name: /vista previa de plantilla/i })).toBeInTheDocument();
    expect(screen.getByText('starter.example.com')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar dominio...'), {
      target: { value: 'starter.example.com' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Importar' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /abrir biblioteca/i }));

    expect(screen.getByRole('button', { name: 'Biblioteca' })).toHaveClass('bg-slate-900');
    expect(screen.getByPlaceholderText('Buscar por nombre...')).toHaveValue('');
    expect(mockImportMutate).toHaveBeenCalledWith({ templateId: 'template-1' });

    await cloneMutationOptions?.onSuccess?.();
    await updateMutationOptions?.onSuccess?.();
    await importMutationOptions?.onSuccess?.();
    await publishMutationOptions?.onSuccess?.();

    expect(invalidateQueriesSpy).toHaveBeenCalledTimes(3);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['groups.list'] });
    expect(mockInvalidate).toHaveBeenCalledTimes(6);
  });
});
