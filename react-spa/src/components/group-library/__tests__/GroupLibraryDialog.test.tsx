import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { GroupLibraryDialog } from '../GroupLibraryDialog';
import type { GroupLibraryGroup, GroupLibraryTemplate, LibraryTab } from '../group-library-helpers';

function renderDialog(
  tab: LibraryTab,
  overrides?: Partial<React.ComponentProps<typeof GroupLibraryDialog>>
) {
  const libraryGroups: GroupLibraryGroup[] = [
    {
      id: 'group-1',
      name: 'math',
      displayName: 'Math Policy',
      whitelistCount: 2,
      blockedSubdomainCount: 1,
      blockedPathCount: 0,
      visibility: 'private',
    },
  ];
  const templates: GroupLibraryTemplate[] = [
    {
      id: 'template-1',
      name: 'starter',
      displayName: 'Starter Template',
      description: 'Base policy',
      ruleCount: 3,
    },
  ];

  const props: React.ComponentProps<typeof GroupLibraryDialog> = {
    isAdmin: true,
    tab,
    search: '',
    onClose: () => undefined,
    onSearchChange: () => undefined,
    onTabChange: () => undefined,
    libraryLoading: false,
    orgGroupsLoading: false,
    templatesLoading: false,
    filteredLibrary: libraryGroups,
    filteredOrgGroups: libraryGroups,
    filteredTemplates: templates,
    cloneDisabled: false,
    importDisabled: false,
    updateDisabled: false,
    publishDisabled: false,
    onPreviewGroup: () => undefined,
    onCloneGroup: () => undefined,
    onPreviewTemplate: () => undefined,
    onImportTemplate: () => undefined,
    onUpdateGroupVisibility: () => undefined,
    onPublishTemplate: () => undefined,
    ...overrides,
  };

  return render(<GroupLibraryDialog {...props} />);
}

describe('GroupLibraryDialog', () => {
  it('renders the library tab and wires preview plus clone actions', () => {
    const onPreviewGroup = vi.fn();
    const onCloneGroup = vi.fn();

    renderDialog('library', { onPreviewGroup, onCloneGroup });

    expect(screen.getByRole('heading', { name: /Policy library/i })).toBeInTheDocument();
    expect(screen.getByText('Math Policy')).toBeInTheDocument();
    expect(screen.getByText('Domains: 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clonar' }));

    expect(onPreviewGroup).toHaveBeenCalledWith('group-1');
    expect(onCloneGroup).toHaveBeenCalledWith('group-1');
  });

  it('renders the templates tab and forwards import actions', () => {
    const onImportTemplate = vi.fn();
    const onPreviewTemplate = vi.fn();

    renderDialog('templates', { onImportTemplate, onPreviewTemplate });

    expect(screen.getByText(/Templates available to every organization/i)).toBeInTheDocument();
    expect(screen.getByText('Starter Template')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(onPreviewTemplate).toHaveBeenCalledWith('template-1');
    expect(onImportTemplate).toHaveBeenCalledWith('template-1');
  });

  it('renders the manage tab for admins and forwards visibility changes', () => {
    const onUpdateGroupVisibility = vi.fn();
    const onPublishTemplate = vi.fn();
    const onTabChange = vi.fn();
    const onSearchChange = vi.fn();

    renderDialog('manage', {
      onUpdateGroupVisibility,
      onPublishTemplate,
      onTabChange,
      onSearchChange,
    });

    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'math' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    fireEvent.change(screen.getByDisplayValue('Private'), {
      target: { value: 'instance_public' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish template' }));

    expect(onSearchChange).toHaveBeenCalledWith('math');
    expect(onTabChange).toHaveBeenCalledWith('library');
    expect(onUpdateGroupVisibility).toHaveBeenCalledWith('group-1', 'instance_public');
    expect(onPublishTemplate).toHaveBeenCalledWith({
      id: 'group-1',
      name: 'math',
      displayName: 'Math Policy',
    });
  });
});
