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
  tagline: 'Valida el modelo en pocas aulas antes de escalar.',
} as const;

export const PUBLIC_CAMPAIGN = {
  classrooms: 5,
  tagline: 'Acceso gratuito para centros de titularidad pública mientras dure la campaña.',
} as const;

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Centro pequeño',
    rangeLabel: '1-10 aulas',
    minClassrooms: 1,
    maxClassrooms: 10,
    pricePerClassroomPerYear: 55,
    approxPricePerDevicePerYear: 1.83,
    tagline: 'Una entrada clara para centros que empiezan con pocas aulas controladas.',
    bestFor: 'Primer despliegue o un único espacio docente con dispositivos institucionales.',
  },
  {
    name: 'Centro mediano',
    rangeLabel: '11-25 aulas',
    minClassrooms: 11,
    maxClassrooms: 25,
    pricePerClassroomPerYear: 45,
    approxPricePerDevicePerYear: 1.5,
    tagline: 'El tramo más habitual para centros que ya quieren una política estable por aula.',
    bestFor: 'Centros completos o etapas con varias aulas y necesidad de criterio homogéneo.',
    recommended: true,
  },
  {
    name: 'Centro grande',
    rangeLabel: '26-50 aulas',
    minClassrooms: 26,
    maxClassrooms: 50,
    pricePerClassroomPerYear: 37,
    approxPricePerDevicePerYear: 1.23,
    tagline: 'Optimizado para despliegues amplios con varias áreas, laboratorios o FP.',
    bestFor: 'Centros con varias líneas, laboratorios o crecimiento por etapas.',
  },
  {
    name: 'Organización educativa',
    rangeLabel: '51-100 aulas',
    minClassrooms: 51,
    maxClassrooms: 100,
    pricePerClassroomPerYear: 32,
    approxPricePerDevicePerYear: 1.07,
    tagline: 'Pensado para organizaciones educativas que necesitan gobernanza centralizada.',
    bestFor: 'Titularidades con varias sedes o estructuras con coordinación TIC central.',
  },
  {
    name: 'Red de centros',
    rangeLabel: '101+ aulas',
    minClassrooms: 101,
    maxClassrooms: null,
    pricePerClassroomPerYear: 27,
    approxPricePerDevicePerYear: 0.9,
    tagline: 'Precio optimizado para redes de centros y despliegues multi-sede.',
    bestFor: 'Implantaciones grandes con alcance por sedes, etapas o ritmo progresivo.',
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
  'Administración básica',
  'Hosting y operación estándar',
  'Actualizaciones incluidas',
  'Soporte por email · respuesta en 2 días hábiles',
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
  'Hasta 30 dispositivos por aula controlada',
  'Onboarding guiado desde la primera semana',
  'Piloto de 90 días para validar encaje',
  'Código abierto y sin vendor lock-in',
  'Servicio gestionado para no cargar más al equipo TIC',
];

export const PER_CLASSROOM_POINTS = [
  'El centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  'El modelo por aula es más fácil de explicar, presupuestar y escalar.',
  'Permite alinear mejor el precio con la realidad operativa del centro.',
];

export const COMPETITIVE_CLAIMS = [
  'Precio por aula inferior al de las principales suites de control escolar del mercado, sin añadir funcionalidades que el centro no necesita.',
  'Una de las formas más asequibles de implantar acceso a Internet intencional en el centro.',
  'Servicio gestionado con un coste por aula especialmente competitivo.',
];

// Precios convertidos a € (aprox.) para consistencia
export const MARKET_BENCHMARKS = [
  {
    vendor: 'Lightspeed',
    reference: 'Filter + Classroom',
    visiblePublicRange: '~5-6 € / dispositivo / año',
  },
  {
    vendor: 'Securly',
    reference: 'Filter',
    visiblePublicRange: '~5,50 € / dispositivo / año',
  },
  {
    vendor: 'GoGuardian',
    reference: 'Admin + Teacher Bundle',
    visiblePublicRange: '~9 € / dispositivo / año',
  },
  {
    vendor: 'Linewize',
    reference: 'Filter + Classwize',
    visiblePublicRange: '~6,50 € / dispositivo / año',
  },
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
