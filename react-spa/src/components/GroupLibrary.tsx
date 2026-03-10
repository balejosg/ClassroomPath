import React, { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { FloatingActionButton } from './FloatingActionButton';
import { GroupLibraryDialog } from './group-library/GroupLibraryDialog';
import {
  type GroupLibraryGroup,
  type GroupLibraryTemplate,
  type LibraryTab,
  type PreviewState,
  filterGroupLibraryItems,
  getRulesPreviewCopy,
} from './group-library/group-library-helpers';
import { RulesPreviewModal } from './group-library/RulesPreviewModal';

const GROUP_LIBRARY_OPEN_TEXT = {
  openAriaLabel: 'Abrir biblioteca de pol\u00edticas',
  openSrLabel: 'Biblioteca',
} as const;

export function GroupLibrary({ userRole }: { userRole?: string }) {
  const canUse = userRole === 'admin' || userRole === 'teacher';
  const isAdmin = userRole === 'admin';

  const queryClient = useQueryClient();
  const cpUtils = cpTrpcReact.useUtils();

  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<LibraryTab>('library');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<PreviewState>(null);

  const rulesLimit = 50;

  const libraryQuery = cpTrpcReact.groups.libraryList.useQuery(undefined, {
    enabled: canUse && isOpen,
  });

  const orgGroupsQuery = cpTrpcReact.groups.list.useQuery(undefined, {
    enabled: canUse && isOpen && isAdmin,
  });

  const templatesQuery = cpTrpcReact.templates.list.useQuery(undefined, {
    enabled: canUse && isOpen,
  });

  const rulesQuery = cpTrpcReact.groups.listRulesPaginated.useQuery(
    {
      groupId: preview?.kind === 'group' ? preview.id : '',
      limit: rulesLimit,
      offset: preview?.offset ?? 0,
      search: preview?.search.trim() ? preview.search.trim() : undefined,
    },
    {
      enabled: canUse && isOpen && preview?.kind === 'group',
    }
  );

  const templateRulesQuery = cpTrpcReact.templates.listRulesPaginated.useQuery(
    {
      templateId: preview?.kind === 'template' ? preview.id : '',
      limit: rulesLimit,
      offset: preview?.offset ?? 0,
      search: preview?.search.trim() ? preview.search.trim() : undefined,
    },
    {
      enabled: canUse && isOpen && preview?.kind === 'template',
    }
  );

  const invalidateOpenPathGroupsList = () =>
    queryClient.invalidateQueries({ queryKey: ['groups.list'] });

  const invalidateGroupLists = async () => {
    await Promise.all([
      invalidateOpenPathGroupsList(),
      cpUtils.groups.list.invalidate(),
      cpUtils.groups.libraryList.invalidate(),
    ]);
  };

  const invalidateOrgGroupsList = async () => {
    await Promise.all([invalidateOpenPathGroupsList(), cpUtils.groups.list.invalidate()]);
  };

  const cloneMutation = cpTrpcReact.groups.clone.useMutation({
    onSuccess: invalidateGroupLists,
  });

  const updateMutation = cpTrpcReact.groups.update.useMutation({
    onSuccess: invalidateGroupLists,
  });

  const importTemplateMutation = cpTrpcReact.templates.import.useMutation({
    onSuccess: invalidateOrgGroupsList,
  });

  const publishTemplateMutation = cpTrpcReact.templates.publishFromGroup.useMutation({
    async onSuccess() {
      await cpUtils.templates.list.invalidate();
    },
  });

  const libraryGroups = (libraryQuery.data ?? []) as GroupLibraryGroup[];
  const orgGroups = (orgGroupsQuery.data ?? []) as GroupLibraryGroup[];
  const templates = (templatesQuery.data ?? []) as GroupLibraryTemplate[];

  const filteredLibrary = useMemo(
    () =>
      filterGroupLibraryItems(
        libraryGroups,
        search,
        (group) => `${group.displayName ?? ''} ${group.name ?? ''}`
      ),
    [libraryGroups, search]
  );

  const filteredOrgGroups = useMemo(
    () =>
      filterGroupLibraryItems(
        orgGroups,
        search,
        (group) => `${group.displayName ?? ''} ${group.name ?? ''}`
      ),
    [orgGroups, search]
  );

  const filteredTemplates = useMemo(
    () =>
      filterGroupLibraryItems(
        templates,
        search,
        (template) =>
          `${template.displayName ?? ''} ${template.name ?? ''} ${template.description ?? ''}`
      ),
    [templates, search]
  );

  const close = () => {
    setIsOpen(false);
    setTab('library');
    setSearch('');
    setPreview(null);
  };

  if (!canUse) return null;

  const previewCopy = preview ? getRulesPreviewCopy(preview.kind) : null;
  const previewPage = preview?.kind === 'group' ? rulesQuery.data : templateRulesQuery.data;
  const previewLoading =
    preview?.kind === 'group' ? rulesQuery.isLoading : templateRulesQuery.isLoading;

  return (
    <>
      <FloatingActionButton
        ariaLabel={GROUP_LIBRARY_OPEN_TEXT.openAriaLabel}
        onClick={() => setIsOpen(true)}
      >
        <BookOpen size={18} />
        <span className="sr-only">{GROUP_LIBRARY_OPEN_TEXT.openSrLabel}</span>
      </FloatingActionButton>

      {isOpen && (
        <>
          <GroupLibraryDialog
            isAdmin={isAdmin}
            tab={tab}
            search={search}
            onClose={close}
            onSearchChange={setSearch}
            onTabChange={setTab}
            libraryLoading={libraryQuery.isLoading}
            orgGroupsLoading={orgGroupsQuery.isLoading}
            templatesLoading={templatesQuery.isLoading}
            filteredLibrary={filteredLibrary}
            filteredOrgGroups={filteredOrgGroups}
            filteredTemplates={filteredTemplates}
            cloneDisabled={cloneMutation.isPending}
            importDisabled={importTemplateMutation.isPending}
            updateDisabled={updateMutation.isPending}
            publishDisabled={publishTemplateMutation.isPending}
            onPreviewGroup={(groupId) =>
              setPreview({ kind: 'group', id: groupId, search: '', offset: 0 })
            }
            onCloneGroup={(groupId) => cloneMutation.mutate({ sourceGroupId: groupId })}
            onPreviewTemplate={(templateId) =>
              setPreview({ kind: 'template', id: templateId, search: '', offset: 0 })
            }
            onImportTemplate={(templateId) => importTemplateMutation.mutate({ templateId })}
            onUpdateGroupVisibility={(groupId, visibility) =>
              updateMutation.mutate({ id: groupId, visibility })
            }
            onPublishTemplate={(group) =>
              publishTemplateMutation.mutate({
                groupId: group.id,
                name: group.name,
                displayName: group.displayName || group.name,
              })
            }
          />

          {preview !== null && previewCopy && (
            <RulesPreviewModal
              title={previewCopy.title}
              subtitle={previewCopy.subtitle}
              search={preview.search}
              onSearchChange={(next) =>
                setPreview((current) =>
                  current ? { ...current, search: next, offset: 0 } : current
                )
              }
              primaryActionLabel={previewCopy.primaryActionLabel}
              onPrimaryAction={() => {
                if (preview.kind === 'group') {
                  cloneMutation.mutate({ sourceGroupId: preview.id });
                  return;
                }

                importTemplateMutation.mutate({ templateId: preview.id });
              }}
              primaryActionDisabled={
                preview.kind === 'group'
                  ? cloneMutation.isPending
                  : importTemplateMutation.isPending
              }
              onClose={() => setPreview(null)}
              isLoading={previewLoading}
              page={previewPage}
              offset={preview.offset}
              onPrevPage={() =>
                setPreview((current) =>
                  current
                    ? { ...current, offset: Math.max(0, current.offset - rulesLimit) }
                    : current
                )
              }
              onNextPage={() =>
                setPreview((current) =>
                  current ? { ...current, offset: current.offset + rulesLimit } : current
                )
              }
              emptyText="No hay reglas para mostrar."
            />
          )}
        </>
      )}
    </>
  );
}
