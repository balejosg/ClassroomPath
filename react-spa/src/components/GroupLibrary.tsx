import React, { useMemo, useState } from 'react';
import { BookOpen, Copy, Eye, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { cpTrpcReact } from '../lib/dual-trpc-provider';

type LibraryTab = 'library' | 'templates' | 'manage';

function normalizeSearch(raw: string): string {
  return raw.trim().toLowerCase();
}

export function GroupLibrary({ userRole }: { userRole?: string }) {
  const canUse = userRole === 'admin' || userRole === 'teacher';
  const isAdmin = userRole === 'admin';

  const queryClient = useQueryClient();
  const cpUtils = cpTrpcReact.useUtils();

  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<LibraryTab>('library');
  const [search, setSearch] = useState('');

  const [viewGroupId, setViewGroupId] = useState<string | null>(null);
  const [rulesSearch, setRulesSearch] = useState('');
  const [rulesOffset, setRulesOffset] = useState(0);
  const rulesLimit = 50;

  const [viewTemplateId, setViewTemplateId] = useState<string | null>(null);
  const [templateRulesSearch, setTemplateRulesSearch] = useState('');
  const [templateRulesOffset, setTemplateRulesOffset] = useState(0);
  const templateRulesLimit = 50;

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
      groupId: viewGroupId ?? '',
      limit: rulesLimit,
      offset: rulesOffset,
      search: rulesSearch.trim() ? rulesSearch.trim() : undefined,
    },
    {
      enabled: canUse && isOpen && viewGroupId !== null,
    }
  );

  const templateRulesQuery = cpTrpcReact.templates.listRulesPaginated.useQuery(
    {
      templateId: viewTemplateId ?? '',
      limit: templateRulesLimit,
      offset: templateRulesOffset,
      search: templateRulesSearch.trim() ? templateRulesSearch.trim() : undefined,
    },
    {
      enabled: canUse && isOpen && viewTemplateId !== null,
    }
  );

  const cloneMutation = cpTrpcReact.groups.clone.useMutation({
    async onSuccess() {
      await Promise.all([
        // OpenPath UI uses this exact key via react-query
        queryClient.invalidateQueries({ queryKey: ['groups.list'] }),
        cpUtils.groups.list.invalidate(),
        cpUtils.groups.libraryList.invalidate(),
      ]);
    },
  });

  const updateMutation = cpTrpcReact.groups.update.useMutation({
    async onSuccess() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups.list'] }),
        cpUtils.groups.list.invalidate(),
        cpUtils.groups.libraryList.invalidate(),
      ]);
    },
  });

  const importTemplateMutation = cpTrpcReact.templates.import.useMutation({
    async onSuccess() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups.list'] }),
        cpUtils.groups.list.invalidate(),
      ]);
    },
  });

  const publishTemplateMutation = cpTrpcReact.templates.publishFromGroup.useMutation({
    async onSuccess() {
      await cpUtils.templates.list.invalidate();
    },
  });

  const libraryGroups = libraryQuery.data ?? [];
  const orgGroups = orgGroupsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  const filteredLibrary = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return libraryGroups;
    return libraryGroups.filter((g) => {
      const hay = `${g.displayName ?? ''} ${g.name ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [libraryGroups, search]);

  const filteredOrgGroups = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return orgGroups;
    return orgGroups.filter((g) => {
      const hay = `${g.displayName ?? ''} ${g.name ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [orgGroups, search]);

  const filteredTemplates = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return templates;
    return templates.filter((t) => {
      const hay = `${t.displayName ?? ''} ${t.name ?? ''} ${t.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [templates, search]);

  const close = () => {
    setIsOpen(false);
    setTab('library');
    setSearch('');
    setViewGroupId(null);
    setRulesSearch('');
    setRulesOffset(0);

    setViewTemplateId(null);
    setTemplateRulesSearch('');
    setTemplateRulesOffset(0);
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
                                setViewTemplateId(t.id);
                                setTemplateRulesSearch('');
                                setTemplateRulesOffset(0);
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
                                setViewGroupId(g.id);
                                setRulesSearch('');
                                setRulesOffset(0);
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

          {/* View modal */}
          {viewGroupId && (
            <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm">
              <div className="fixed inset-x-0 bottom-0 top-0 md:inset-y-10 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      Vista previa (solo lectura)
                    </h3>
                    <p className="text-sm text-slate-500">Puedes clonar para editar.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewGroupId(null)}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    aria-label="Cerrar"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="px-5 pt-4 flex items-center gap-3">
                  <input
                    value={rulesSearch}
                    onChange={(e) => {
                      setRulesSearch(e.target.value);
                      setRulesOffset(0);
                    }}
                    placeholder="Buscar dominio..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  <button
                    type="button"
                    onClick={() => cloneMutation.mutate({ sourceGroupId: viewGroupId })}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                    disabled={cloneMutation.isPending}
                  >
                    <Copy size={16} />
                    Clonar
                  </button>
                </div>

                <div className="p-5 flex-1 overflow-y-auto">
                  {rulesQuery.isLoading ? (
                    <div className="text-sm text-slate-500">Cargando reglas...</div>
                  ) : rulesQuery.data?.rules?.length ? (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500">
                        Total: {rulesQuery.data.total} (mostrando {rulesQuery.data.rules.length})
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
                            {rulesQuery.data.rules.map((r) => (
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
                          onClick={() => setRulesOffset(Math.max(0, rulesOffset - rulesLimit))}
                          disabled={rulesOffset === 0}
                          className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          onClick={() => setRulesOffset(rulesOffset + rulesLimit)}
                          disabled={!rulesQuery.data.hasMore}
                          className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No hay reglas para mostrar.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Template view modal */}
          {viewTemplateId && (
            <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm">
              <div className="fixed inset-x-0 bottom-0 top-0 md:inset-y-10 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Vista previa de plantilla</h3>
                    <p className="text-sm text-slate-500">Puedes importar para editar.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewTemplateId(null)}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    aria-label="Cerrar"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="px-5 pt-4 flex items-center gap-3">
                  <input
                    value={templateRulesSearch}
                    onChange={(e) => {
                      setTemplateRulesSearch(e.target.value);
                      setTemplateRulesOffset(0);
                    }}
                    placeholder="Buscar dominio..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  <button
                    type="button"
                    onClick={() => importTemplateMutation.mutate({ templateId: viewTemplateId })}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                    disabled={importTemplateMutation.isPending}
                  >
                    <Copy size={16} />
                    Importar
                  </button>
                </div>

                <div className="p-5 flex-1 overflow-y-auto">
                  {templateRulesQuery.isLoading ? (
                    <div className="text-sm text-slate-500">Cargando reglas...</div>
                  ) : templateRulesQuery.data?.rules?.length ? (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500">
                        Total: {templateRulesQuery.data.total} (mostrando{' '}
                        {templateRulesQuery.data.rules.length})
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
                            {templateRulesQuery.data.rules.map((r) => (
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
                          onClick={() =>
                            setTemplateRulesOffset(
                              Math.max(0, templateRulesOffset - templateRulesLimit)
                            )
                          }
                          disabled={templateRulesOffset === 0}
                          className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setTemplateRulesOffset(templateRulesOffset + templateRulesLimit)
                          }
                          disabled={!templateRulesQuery.data.hasMore}
                          className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No hay reglas para mostrar.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
