export type LibraryTab = 'library' | 'templates' | 'manage';

export type GroupLibraryGroup = {
  id: string;
  name: string;
  displayName?: string | null;
  whitelistCount: number;
  blockedSubdomainCount: number;
  blockedPathCount: number;
  visibility?: 'private' | 'instance_public' | null;
};

export type GroupLibraryTemplate = {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  ruleCount: number;
};

export type RulesRow = {
  id: string;
  type: string;
  value: string;
};

export type RulesPage = {
  total: number;
  rules: RulesRow[];
  hasMore: boolean;
};

export type PreviewKind = 'group' | 'template';

export type PreviewState = {
  kind: PreviewKind;
  id: string;
  search: string;
  offset: number;
} | null;

const RULES_PREVIEW_COPY = {
  group: {
    title: 'Vista previa (solo lectura)',
    subtitle: 'Puedes clonar para editar.',
    primaryActionLabel: 'Clonar',
  },
  template: {
    title: 'Vista previa de plantilla',
    subtitle: 'Puedes importar para editar.',
    primaryActionLabel: 'Importar',
  },
} as const;

export function normalizeGroupLibrarySearch(raw: string): string {
  return raw.trim().toLowerCase();
}

export function filterGroupLibraryItems<T>(
  items: readonly T[],
  search: string,
  buildHaystack: (item: T) => string
): T[] {
  const query = normalizeGroupLibrarySearch(search);
  if (!query) return [...items];

  return items.filter((item) => {
    const haystack = normalizeGroupLibrarySearch(buildHaystack(item));
    return haystack.includes(query);
  });
}

export function getGroupLibraryDomainCount(group: {
  whitelistCount: number;
  blockedSubdomainCount: number;
  blockedPathCount: number;
}): number {
  return group.whitelistCount + group.blockedSubdomainCount + group.blockedPathCount;
}

export function getRulesPreviewCopy(kind: PreviewKind) {
  return RULES_PREVIEW_COPY[kind];
}
