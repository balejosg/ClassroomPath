import React, { createContext, useContext, useMemo } from 'react';

import {
  OpenPathI18nProvider,
  resolveProductLocale,
  type ProductI18nParams,
  type ProductLocale,
} from '../openpath/public-i18n';

const classroomPathI18nEn = {
  'app.loader.preparing': 'Preparing ClassroomPath...',
  'app.loader.panel': 'Loading your panel...',
  'app.title.dashboard.admin': 'Overview',
  'app.title.dashboard.user': 'My Dashboard',
  'app.title.classrooms.admin': 'Classroom Management',
  'app.title.classrooms.user': 'Classrooms',
  'app.title.groups.admin': 'Groups and Policies',
  'app.title.groups.user': 'My Policies',
  'app.title.rules.default': 'Rules Management',
  'app.title.rules.group': 'Rules: {groupName}',
  'app.title.users.admin': 'User Administration',
  'app.title.domainRequests.admin': 'Access Requests',
  'app.title.settings': 'Settings',
  'domainApproval.loading': 'Loading request...',
  'domainApproval.approved.title': 'Domain approved',
  'domainApproval.approved.body': 'The request has been added to the allowlist.',
  'domainApproval.backToRequests': 'Back to requests',
  'domainApproval.unavailable.title': 'Request unavailable',
  'domainApproval.unavailable.body':
    'The request may have been approved, rejected, or no longer assigned to your groups.',
  'domainApproval.pending.label': 'Pending request',
  'domainApproval.pending.title': 'Approve domain',
  'domainApproval.domain.label': 'Domain',
  'domainApproval.group.label': 'Group',
  'domainApproval.approve.pending': 'Approving...',
  'domainApproval.approve.action': 'Approve domain',
  'public.landing.title': 'Classroom web filtering | ClassroomPath',
  'public.landing.description':
    'Control what opens and what gets blocked in each classroom. Managed service on OpenPath, classroom-based pricing, and remote activation with the school IT team.',
  'public.pricing.title': 'Classroom web filtering pricing | ClassroomPath',
  'public.pricing.description':
    'Calculate the cost of ClassroomPath by classroom count. Public pricing, separate onboarding, lightweight remote activation, and managed service on OpenPath.',
};

type ClassroomPathI18nKey = keyof typeof classroomPathI18nEn;

const classroomPathI18nEs: Record<ClassroomPathI18nKey, string> = {
  'app.loader.preparing': 'Preparando ClassroomPath...',
  'app.loader.panel': 'Cargando tu panel...',
  'app.title.dashboard.admin': 'Vista General',
  'app.title.dashboard.user': 'Mi Panel',
  'app.title.classrooms.admin': 'Gestión de Aulas',
  'app.title.classrooms.user': 'Aulas',
  'app.title.groups.admin': 'Grupos y Políticas',
  'app.title.groups.user': 'Mis Políticas',
  'app.title.rules.default': 'Gestión de Reglas',
  'app.title.rules.group': 'Reglas: {groupName}',
  'app.title.users.admin': 'Administración de Usuarios',
  'app.title.domainRequests.admin': 'Solicitudes de Acceso',
  'app.title.settings': 'Configuración',
  'domainApproval.loading': 'Cargando solicitud...',
  'domainApproval.approved.title': 'Dominio aprobado',
  'domainApproval.approved.body': 'La solicitud ya se ha añadido a la whitelist.',
  'domainApproval.backToRequests': 'Volver a solicitudes',
  'domainApproval.unavailable.title': 'Solicitud no disponible',
  'domainApproval.unavailable.body':
    'La solicitud puede haber sido aprobada, rechazada o ya no estar asignada a tus grupos.',
  'domainApproval.pending.label': 'Solicitud pendiente',
  'domainApproval.pending.title': 'Aprobar dominio',
  'domainApproval.domain.label': 'Dominio',
  'domainApproval.group.label': 'Grupo',
  'domainApproval.approve.pending': 'Aprobando...',
  'domainApproval.approve.action': 'Aprobar dominio',
  'public.landing.title': 'Filtrado web escolar por aula | ClassroomPath',
  'public.landing.description':
    'Controla qué se abre y qué se bloquea en cada aula. Servicio gestionado sobre OpenPath, precio por aula y activación remota con el IT del centro.',
  'public.pricing.title': 'Precios de filtrado web escolar por aula | ClassroomPath',
  'public.pricing.description':
    'Calcula el coste de ClassroomPath por número de aulas. Precio público, onboarding separado, activación remota ligera y servicio gestionado sobre OpenPath.',
};

export const classroomPathI18nCatalogs: Record<
  ProductLocale,
  Record<ClassroomPathI18nKey, string>
> = {
  en: classroomPathI18nEn,
  es: classroomPathI18nEs,
};

export type ClassroomPathT = (key: ClassroomPathI18nKey, params?: ProductI18nParams) => string;

interface ClassroomPathI18nContextValue {
  locale: ProductLocale;
  t: ClassroomPathT;
}

const ClassroomPathI18nContext = createContext<ClassroomPathI18nContextValue | null>(null);

function formatMessage(message: string, params: ProductI18nParams = {}): string {
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      return match;
    }
    return String(params[name]);
  });
}

export function translateClassroomPathText(
  locale: ProductLocale,
  key: ClassroomPathI18nKey,
  params?: ProductI18nParams
): string {
  return formatMessage(classroomPathI18nCatalogs[locale][key], params);
}

function getHydrationLocale(): string | null {
  if (typeof document === 'undefined') return null;

  return (
    document.documentElement.dataset.classroompathLocale ??
    document.getElementById('root')?.dataset.classroompathLocale ??
    null
  );
}

export function resolveClassroomPathLocale(
  locale?: string | readonly string[] | null
): ProductLocale {
  return resolveProductLocale(locale ?? getHydrationLocale());
}

export function ClassroomPathI18nProvider({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale?: string | readonly string[] | null;
}) {
  const resolvedLocale = resolveClassroomPathLocale(locale);
  const value = useMemo<ClassroomPathI18nContextValue>(
    () => ({
      locale: resolvedLocale,
      t: (key, params) => translateClassroomPathText(resolvedLocale, key, params),
    }),
    [resolvedLocale]
  );

  return (
    <OpenPathI18nProvider locale={resolvedLocale}>
      <ClassroomPathI18nContext.Provider value={value}>
        {children}
      </ClassroomPathI18nContext.Provider>
    </OpenPathI18nProvider>
  );
}

export function useClassroomPathI18n(): ClassroomPathI18nContextValue {
  const value = useContext(ClassroomPathI18nContext);
  if (value) return value;

  const locale = resolveClassroomPathLocale();
  return {
    locale,
    t: (key, params) => translateClassroomPathText(locale, key, params),
  };
}

export function useClassroomPathT(): ClassroomPathT {
  return useClassroomPathI18n().t;
}
