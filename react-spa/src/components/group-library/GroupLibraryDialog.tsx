import React from 'react';
import { Copy, Eye } from 'lucide-react';

import {
  type GroupLibraryGroup,
  type GroupLibraryTemplate,
  type LibraryTab,
  getGroupLibraryDomainCount,
} from './group-library-helpers';
import type { ClassroomPathT } from '../../i18n/classroompath-i18n';
import { Modal } from '../../openpath/public-ui';

type PublishableGroup = Pick<GroupLibraryGroup, 'id' | 'name' | 'displayName'>;

type GroupLibraryDialogProps = {
  isAdmin: boolean;
  tab: LibraryTab;
  search: string;
  onClose: () => void;
  onSearchChange: (next: string) => void;
  onTabChange: (next: LibraryTab) => void;
  libraryLoading: boolean;
  orgGroupsLoading: boolean;
  templatesLoading: boolean;
  filteredLibrary: GroupLibraryGroup[];
  filteredOrgGroups: GroupLibraryGroup[];
  filteredTemplates: GroupLibraryTemplate[];
  cloneDisabled: boolean;
  importDisabled: boolean;
  updateDisabled: boolean;
  publishDisabled: boolean;
  onPreviewGroup: (groupId: string) => void;
  onCloneGroup: (groupId: string) => void;
  onPreviewTemplate: (templateId: string) => void;
  onImportTemplate: (templateId: string) => void;
  onUpdateGroupVisibility: (groupId: string, visibility: 'private' | 'instance_public') => void;
  onPublishTemplate: (group: PublishableGroup) => void;
  t: ClassroomPathT;
};

function TabButton(props: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
        props.isActive
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {props.label}
    </button>
  );
}

export function GroupLibraryDialog(props: GroupLibraryDialogProps) {
  const { t } = props;

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      title={t('groupLibrary.title')}
      closeLabel={t('app.common.close')}
      className="h-[calc(100dvh-3rem)] max-w-4xl"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        data-testid="group-library-dialog-controls"
        className="border-b border-slate-200 px-5 py-4"
      >
        <p className="mb-4 text-sm text-slate-500">{t('groupLibrary.description')}</p>
        <div className="flex items-center gap-3">
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder={t('groupLibrary.searchPlaceholder')}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />

          <div className="flex items-center gap-2">
            <TabButton
              label={t('groupLibrary.libraryTab')}
              isActive={props.tab === 'library'}
              onClick={() => props.onTabChange('library')}
            />
            <TabButton
              label={t('groupLibrary.templatesTab')}
              isActive={props.tab === 'templates'}
              onClick={() => props.onTabChange('templates')}
            />
            {props.isAdmin && (
              <TabButton
                label={t('groupLibrary.manageTab')}
                isActive={props.tab === 'manage'}
                onClick={() => props.onTabChange('manage')}
              />
            )}
          </div>
        </div>
      </div>

      <div data-testid="group-library-dialog-body" className="min-h-0 flex-1 overflow-y-auto p-5">
        {props.tab === 'manage' && props.isAdmin ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              {t('groupLibrary.manageVisibilityPrefix')}{' '}
              <span className="font-medium">{t('groupLibrary.visibility.public')}</span>{' '}
              {t('groupLibrary.manageVisibilitySuffix')}
            </div>

            {props.orgGroupsLoading ? (
              <div className="text-sm text-slate-500">{t('app.common.loading')}</div>
            ) : props.filteredOrgGroups.length === 0 ? (
              <div className="text-sm text-slate-500">{t('groupLibrary.emptyOrg')}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {props.filteredOrgGroups.map((group) => (
                  <div
                    key={group.id}
                    className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {group.displayName || group.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{group.name}</div>
                      <div className="text-xs text-slate-500 mt-2">
                        {t('groupLibrary.domains')}: {getGroupLibraryDomainCount(group)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <select
                        value={group.visibility ?? 'private'}
                        onChange={(event) =>
                          props.onUpdateGroupVisibility(
                            group.id,
                            event.target.value as 'private' | 'instance_public'
                          )
                        }
                        className="text-sm rounded-lg border border-slate-200 px-2 py-1 bg-white"
                        disabled={props.updateDisabled}
                      >
                        <option value="private">{t('groupLibrary.visibility.private')}</option>
                        <option value="instance_public">
                          {t('groupLibrary.visibility.instancePublic')}
                        </option>
                      </select>

                      <button
                        type="button"
                        onClick={() =>
                          props.onPublishTemplate({
                            id: group.id,
                            name: group.name,
                            displayName: group.displayName,
                          })
                        }
                        className="text-xs px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                        disabled={props.publishDisabled}
                      >
                        {t('groupLibrary.publishTemplate')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : props.tab === 'templates' ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-600">{t('groupLibrary.templatesDescription')}</div>

            {props.templatesLoading ? (
              <div className="text-sm text-slate-500">{t('app.common.loading')}</div>
            ) : props.filteredTemplates.length === 0 ? (
              <div className="text-sm text-slate-500">{t('groupLibrary.noPublishedTemplates')}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {props.filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {template.displayName || template.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{template.name}</div>
                      {template.description && (
                        <div className="text-xs text-slate-500 mt-2 line-clamp-2">
                          {template.description}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 mt-2">
                        {t('groupLibrary.rules')}: {template.ruleCount}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => props.onPreviewTemplate(template.id)}
                        className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                        aria-label={t('groupLibrary.previewAction')}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onImportTemplate(template.id)}
                        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                        aria-label={t('groupLibrary.import')}
                        disabled={props.importDisabled}
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {props.libraryLoading ? (
              <div className="text-sm text-slate-500">{t('app.common.loading')}</div>
            ) : props.filteredLibrary.length === 0 ? (
              <div className="text-sm text-slate-500">{t('groupLibrary.emptyLibrary')}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {props.filteredLibrary.map((group) => (
                  <div
                    key={group.id}
                    className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {group.displayName || group.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{group.name}</div>
                      <div className="text-xs text-slate-500 mt-2">
                        {t('groupLibrary.domains')}: {getGroupLibraryDomainCount(group)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => props.onPreviewGroup(group.id)}
                        className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                        aria-label={t('groupLibrary.previewAction')}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onCloneGroup(group.id)}
                        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                        aria-label={t('groupLibrary.clone')}
                        disabled={props.cloneDisabled}
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
