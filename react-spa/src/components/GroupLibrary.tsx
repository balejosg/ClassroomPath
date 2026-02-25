import React, { useMemo, useState } from 'react';
import { BookOpen, Copy, Eye, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { cpTrpcReact } from '../lib/dual-trpc-provider';

type LibraryTab = 'library' | 'templates' | 'manage';

function normalizeSearch(raw: string): string {
  return raw.trim().toLowerCase();
}

function filterBySearch<T>(items: T[], search: string, buildHaystack: (item: T) => string): T[] {
  const q = normalizeSearch(search);
  if (!q) return items;

  return items.filter((item) => {
    const hay = normalizeSearch(buildHaystack(item));
    return hay.includes(q);
  });
}

type RulesRow = {
  id: string;
  type: string;
  value: string;
};

type RulesPage = {
  total: number;
  rules: RulesRow[];
  hasMore: boolean;
};

type PreviewKind = 'group' | 'template';
type PreviewState = {
  kind: PreviewKind;
  id: string;
  search: string;
  offset: number;
} | null;

function RulesPreviewModal(props: {
  title: string;
  subtitle: string;
  search: string;
  onSearchChange: (next: string) => void;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  primaryActionDisabled: boolean;
  onClose: () => void;
  query: { isLoading: boolean; data?: RulesPage };
  offset: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  emptyText: string;
}) {
  const rules = props.query.data?.rules ?? [];
  const total = props.query.data?.total ?? 0;
  const hasMore = props.query.data?.hasMore ?? false;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm">
      <div className="fixed inset-x-0 bottom-0 top-0 md:inset-y-10 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{props.title}</h3>
            <p className="text-sm text-slate-500">{props.subtitle}</p>
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
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder="Buscar dominio..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <button
            type="button"
            onClick={props.onPrimaryAction}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            disabled={props.primaryActionDisabled}
          >
            <Copy size={16} />
            {props.primaryActionLabel}
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {props.query.isLoading ? (
            <div className="text-sm text-slate-500">Cargando reglas...</div>
          ) : rules.length ? (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                Total: {total} (mostrando {rules.length})
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">Tipo</th>
                      <th className="text-left font-semibold px-3 py-2">Dominio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                          {r.type}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-900 break-all">
                          {r.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={props.onPrevPage}
                  disabled={props.offset === 0}
                  className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={props.onNextPage}
                  disabled={!hasMore}
                  className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                >
                  Siguiente
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">{props.emptyText}</div>
          )}
        </div>
      </div>
    </div>
  );
}

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
      // OpenPath UI uses this exact key via react-query
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

  const libraryGroups = libraryQuery.data ?? [];
  const orgGroups = orgGroupsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  const filteredLibrary = useMemo(
    () => filterBySearch(libraryGroups, search, (g) => `${g.displayName ?? ''} ${g.name ?? ''}`),
    [libraryGroups, search]
  );

  const filteredOrgGroups = useMemo(
    () => filterBySearch(orgGroups, search, (g) => `${g.displayName ?? ''} ${g.name ?? ''}`),
    [orgGroups, search]
  );

  const filteredTemplates = useMemo(
    () =>
      filterBySearch(
        templates,
        search,
        (t) => `${t.displayName ?? ''} ${t.name ?? ''} ${t.description ?? ''}`
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

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-900 text-white px-4 py-3 shadow-lg hover:bg-slate-800 active:bg-slate-950 transition-colors"
        aria-label="Abrir biblioteca de politicas"
      >
        <BookOpen size={18} />
        <span className="text-sm font-semibold">Biblioteca</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <div className="fixed inset-x-0 bottom-0 top-0 md:inset-y-6 md:left-1/2 md:-translate-x-1/2 md:max-w-4xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Biblioteca de politicas</h2>
                <p className="text-sm text-slate-500">
                  Ver y clonar politicas compartidas en tu organizacion.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-5 pt-4 flex items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTab('library')}
                  className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                    tab === 'library'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Biblioteca
                </button>
                <button
                  type="button"
                  onClick={() => setTab('templates')}
                  className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                    tab === 'templates'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Plantillas
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setTab('manage')}
                    className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                      tab === 'manage'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Gestionar
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 flex-1 overflow-y-auto">
              {tab === 'manage' && isAdmin ? (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600">
                    Marca una politica como <span className="font-medium">Publica</span> para que
                    aparezca en la biblioteca de la organizacion.
                  </div>

                  {orgGroupsQuery.isLoading ? (
                    <div className="text-sm text-slate-500">Cargando...</div>
                  ) : filteredOrgGroups.length === 0 ? (
                    <div className="text-sm text-slate-500">No hay politicas para mostrar.</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredOrgGroups.map((g) => (
                        <div
                          key={g.id}
                          className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {g.displayName || g.name}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{g.name}</div>
                            <div className="text-xs text-slate-500 mt-2">
                              Dominios:{' '}
                              {g.whitelistCount + g.blockedSubdomainCount + g.blockedPathCount}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <select
                              value={g.visibility ?? 'private'}
                              onChange={(e) =>
                                updateMutation.mutate({
                                  id: g.id,
                                  visibility: e.target.value as 'private' | 'instance_public',
                                })
                              }
                              className="text-sm rounded-lg border border-slate-200 px-2 py-1 bg-white"
                              disabled={updateMutation.isPending}
                            >
                              <option value="private">Privada</option>
                              <option value="instance_public">Publica (org)</option>
                            </select>

                            <button
                              type="button"
                              onClick={() =>
                                publishTemplateMutation.mutate({
                                  groupId: g.id,
                                  name: g.name,
                                  displayName: g.displayName || g.name,
                                })
                              }
                              className="text-xs px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                              disabled={publishTemplateMutation.isPending}
                            >
                              Publicar plantilla
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : tab === 'templates' ? (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600">
                    Plantillas disponibles para todas las organizaciones (se copian al importar).
                  </div>

                  {templatesQuery.isLoading ? (
                    <div className="text-sm text-slate-500">Cargando...</div>
                  ) : filteredTemplates.length === 0 ? (
                    <div className="text-sm text-slate-500">No hay plantillas publicadas.</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredTemplates.map((t) => (
                        <div
                          key={t.id}
                          className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {t.displayName || t.name}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{t.name}</div>
                            {t.description && (
                              <div className="text-xs text-slate-500 mt-2 line-clamp-2">
                                {t.description}
                              </div>
                            )}
                            <div className="text-xs text-slate-500 mt-2">Reglas: {t.ruleCount}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPreview({ kind: 'template', id: t.id, search: '', offset: 0 });
                              }}
                              className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                              aria-label="Ver"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => importTemplateMutation.mutate({ templateId: t.id })}
                              className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                              aria-label="Importar"
                              disabled={importTemplateMutation.isPending}
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
                  {libraryQuery.isLoading ? (
                    <div className="text-sm text-slate-500">Cargando...</div>
                  ) : filteredLibrary.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      No hay politicas publicas en esta organizacion.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredLibrary.map((g) => (
                        <div
                          key={g.id}
                          className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {g.displayName || g.name}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{g.name}</div>
                            <div className="text-xs text-slate-500 mt-2">
                              Dominios:{' '}
                              {g.whitelistCount + g.blockedSubdomainCount + g.blockedPathCount}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPreview({ kind: 'group', id: g.id, search: '', offset: 0 });
                              }}
                              className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                              aria-label="Ver"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => cloneMutation.mutate({ sourceGroupId: g.id })}
                              className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                              aria-label="Clonar"
                              disabled={cloneMutation.isPending}
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

          {preview !== null && (
            <RulesPreviewModal
              title={
                preview.kind === 'group'
                  ? 'Vista previa (solo lectura)'
                  : 'Vista previa de plantilla'
              }
              subtitle={
                preview.kind === 'group'
                  ? 'Puedes clonar para editar.'
                  : 'Puedes importar para editar.'
              }
              search={preview.search}
              onSearchChange={(next) =>
                setPreview((current) =>
                  current ? { ...current, search: next, offset: 0 } : current
                )
              }
              primaryActionLabel={preview.kind === 'group' ? 'Clonar' : 'Importar'}
              onPrimaryAction={() => {
                if (preview.kind === 'group') {
                  cloneMutation.mutate({ sourceGroupId: preview.id });
                } else {
                  importTemplateMutation.mutate({ templateId: preview.id });
                }
              }}
              primaryActionDisabled={
                preview.kind === 'group'
                  ? cloneMutation.isPending
                  : importTemplateMutation.isPending
              }
              onClose={() => setPreview(null)}
              query={preview.kind === 'group' ? rulesQuery : templateRulesQuery}
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
        </div>
      )}
    </>
  );
}
