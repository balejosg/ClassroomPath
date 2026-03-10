import React from 'react';
import { Copy, Eye, X } from 'lucide-react';

import {
  type GroupLibraryGroup,
  type GroupLibraryTemplate,
  type LibraryTab,
  getGroupLibraryDomainCount,
} from './group-library-helpers';

const GROUP_LIBRARY_TEXT = {
  title: 'Biblioteca de pol\u00edticas',
  description: 'Ver y clonar pol\u00edticas compartidas en tu organizaci\u00f3n.',
  emptyOrg: 'No hay pol\u00edticas para mostrar.',
  emptyLibrary: 'No hay pol\u00edticas p\u00fablicas en esta organizaci\u00f3n.',
} as const;

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
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
      <div className="fixed inset-x-0 bottom-0 top-0 md:inset-y-6 md:left-1/2 md:-translate-x-1/2 md:max-w-4xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{GROUP_LIBRARY_TEXT.title}</h2>
            <p className="text-sm text-slate-500">{GROUP_LIBRARY_TEXT.description}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 pt-4 flex items-center gap-3">
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />

          <div className="flex items-center gap-2">
            <TabButton
              label="Biblioteca"
              isActive={props.tab === 'library'}
              onClick={() => props.onTabChange('library')}
            />
            <TabButton
              label="Plantillas"
              isActive={props.tab === 'templates'}
              onClick={() => props.onTabChange('templates')}
            />
            {props.isAdmin && (
              <TabButton
                label="Gestionar"
                isActive={props.tab === 'manage'}
                onClick={() => props.onTabChange('manage')}
              />
            )}
          </div>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {props.tab === 'manage' && props.isAdmin ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-600">
                {'Marca una pol\u00edtica como '}
                <span className="font-medium">{'P\u00fablica'}</span>
                {' para que aparezca en la biblioteca de la organizaci\u00f3n.'}
              </div>

              {props.orgGroupsLoading ? (
                <div className="text-sm text-slate-500">Cargando...</div>
              ) : props.filteredOrgGroups.length === 0 ? (
                <div className="text-sm text-slate-500">{GROUP_LIBRARY_TEXT.emptyOrg}</div>
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
                          Dominios: {getGroupLibraryDomainCount(group)}
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
                          <option value="private">Privada</option>
                          <option value="instance_public">{'P\u00fablica (org)'}</option>
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
                          Publicar plantilla
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : props.tab === 'templates' ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-600">
                Plantillas disponibles para todas las organizaciones (se copian al importar).
              </div>

              {props.templatesLoading ? (
                <div className="text-sm text-slate-500">Cargando...</div>
              ) : props.filteredTemplates.length === 0 ? (
                <div className="text-sm text-slate-500">No hay plantillas publicadas.</div>
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
                          Reglas: {template.ruleCount}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => props.onPreviewTemplate(template.id)}
                          className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                          aria-label="Ver"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => props.onImportTemplate(template.id)}
                          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                          aria-label="Importar"
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
                <div className="text-sm text-slate-500">Cargando...</div>
              ) : props.filteredLibrary.length === 0 ? (
                <div className="text-sm text-slate-500">{GROUP_LIBRARY_TEXT.emptyLibrary}</div>
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
                          Dominios: {getGroupLibraryDomainCount(group)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => props.onPreviewGroup(group.id)}
                          className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                          aria-label="Ver"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => props.onCloneGroup(group.id)}
                          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                          aria-label="Clonar"
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
      </div>
    </div>
  );
}
