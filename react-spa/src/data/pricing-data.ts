export type PricingTier = {
  name: string;
  rangeLabel: string;
  minClassrooms: number;
  maxClassrooms: number | null;
  pricePerClassroomPerYear: number;
  approxPricePerDevicePerYear: number;
  tagline: string;
  bestFor: string;
  recommended?: boolean;
};

export type OnboardingTier = {
  rangeLabel: string;
  minClassrooms: number;
  maxClassrooms: number | null;
  oneTimeFee: number | null;
  label?: string;
};

export const PILOT = {
  name: 'Piloto',
  classrooms: 5,
  durationDays: 90,
  totalPrice: 290,
  tagline:
    'Valida el modelo en pocas aulas antes de escalar. Es la opción más útil cuando necesitas comprobar encaje operativo y evidencia interna con poco riesgo.',
} as const;

export const ACTIVATION_STARTER = {
  name: 'Activación remota ligera',
  classrooms: 2,
  totalPrice: 149,
  tagline:
    'Incluye checklist técnica, una sesión remota con el IT del centro y apoyo para dejar 1-2 aulas operativas sin asumir una implantación completa.',
} as const;

export const PUBLIC_CAMPAIGN = {
  classrooms: 5,
  tagline:
    'Acceso sin coste para hasta 5 aulas mientras haya disponibilidad y se verifique titularidad pública.',
} as const;

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Centro pequeño',
    rangeLabel: '1-10 aulas',
    minClassrooms: 1,
    maxClassrooms: 10,
    pricePerClassroomPerYear: 55,
    approxPricePerDevicePerYear: 1.83,
    tagline: 'Para primeros despliegues o un único espacio docente con dispositivos del centro.',
    bestFor: 'Primer despliegue o un único espacio docente con dispositivos del centro.',
  },
  {
    name: 'Centro mediano',
    rangeLabel: '11-25 aulas',
    minClassrooms: 11,
    maxClassrooms: 25,
    pricePerClassroomPerYear: 45,
    approxPricePerDevicePerYear: 1.5,
    tagline: 'El tramo más habitual para centros que ya quieren una política estable por aula.',
    bestFor: 'El tramo más habitual para centros que ya quieren una política estable por aula.',
    recommended: true,
  },
  {
    name: 'Centro grande',
    rangeLabel: '26-50 aulas',
    minClassrooms: 26,
    maxClassrooms: 50,
    pricePerClassroomPerYear: 37,
    approxPricePerDevicePerYear: 1.23,
    tagline: 'Pensado para centros con varias líneas, laboratorios o crecimiento por etapas.',
    bestFor: 'Centros con varias líneas, laboratorios o crecimiento por etapas.',
  },
  {
    name: 'Organización educativa',
    rangeLabel: '51-100 aulas',
    minClassrooms: 51,
    maxClassrooms: 100,
    pricePerClassroomPerYear: 32,
    approxPricePerDevicePerYear: 1.07,
    tagline: 'Para estructuras con coordinación TIC central y varias sedes o etapas.',
    bestFor: 'Para estructuras con coordinación TIC central y varias sedes o etapas.',
  },
  {
    name: 'Red de centros',
    rangeLabel: '101+ aulas',
    minClassrooms: 101,
    maxClassrooms: null,
    pricePerClassroomPerYear: 27,
    approxPricePerDevicePerYear: 0.9,
    tagline: 'Precio optimizado para redes de centros y despliegues multi-sede.',
    bestFor: 'Precio optimizado para despliegues multi-sede y redes educativas.',
  },
];

export const ONBOARDING_TIERS: OnboardingTier[] = [
  {
    rangeLabel: 'Hasta 25 aulas',
    minClassrooms: 1,
    maxClassrooms: 25,
    oneTimeFee: 490,
  },
  {
    rangeLabel: '26-100 aulas',
    minClassrooms: 26,
    maxClassrooms: 100,
    oneTimeFee: 890,
  },
  {
    rangeLabel: '101+ aulas',
    minClassrooms: 101,
    maxClassrooms: null,
    oneTimeFee: null,
    label: 'Consultar',
  },
];

export const INCLUDED_PER_CLASSROOM = [
  'Hasta 30 dispositivos por aula',
  'Políticas de acceso a Internet',
  'Cola de solicitudes de desbloqueo',
  'Panel de administración',
  'Hosting y operación incluidos',
  'Actualizaciones incluidas',
  'Soporte estándar por email',
  'Servicio gestionado sobre OpenPath',
];

export const NOT_INCLUDED_BASE_PLAN = [
  'SSO empresarial',
  'SLA premium',
  'Migración avanzada',
  'Formación onsite',
  'Soporte prioritario',
  'Políticas muy personalizadas por sede o etapa',
];

export const VALUE_BULLETS = [
  'Precio público desde el primer clic',
  'Unidad de compra clara: el aula',
  'Activación remota para empezar con poco alcance',
  'Servicio gestionado sobre software abierto',
  'Sin dependencia obligatoria de proveedor',
];

export const PER_CLASSROOM_POINTS = [
  'El centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  'Más fácil de explicar en presupuesto',
  'Más fácil de escalar por espacios reales',
  'Más claro al separar arranque y renovación',
  'Más coherente con un servicio gestionado',
];

// ── Helpers ──────────────────────────────────────────────────────────────────────

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPricePerDevice(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: value < 1 ? 2 : 1,
    maximumFractionDigits: 2,
  }).format(value);
}

export function getPricingTier(classrooms: number) {
  return (
    PRICING_TIERS.find(
      (tier) =>
        classrooms >= tier.minClassrooms &&
        (tier.maxClassrooms === null || classrooms <= tier.maxClassrooms)
    ) ?? PRICING_TIERS[0]
  );
}

export function getOnboardingTier(classrooms: number) {
  return (
    ONBOARDING_TIERS.find(
      (tier) =>
        classrooms >= tier.minClassrooms &&
        (tier.maxClassrooms === null || classrooms <= tier.maxClassrooms)
    ) ?? ONBOARDING_TIERS[0]
  );
}

export function getPricingQuote(classrooms: number) {
  const tier = getPricingTier(classrooms);
  const onboardingTier = getOnboardingTier(classrooms);
  const annualTotal = classrooms * tier.pricePerClassroomPerYear;
  const onboardingFee = onboardingTier.oneTimeFee;

  return {
    classrooms,
    tier,
    onboardingTier,
    annualTotal,
    onboardingFee,
    totalFirstYear: onboardingFee === null ? null : annualTotal + onboardingFee,
    approxPricePerDevicePerYear: tier.approxPricePerDevicePerYear,
  };
}
