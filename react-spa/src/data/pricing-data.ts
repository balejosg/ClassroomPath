import type { ClassroomPathT } from '../i18n/classroompath-i18n';

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
  name: 'Pilot',
  classrooms: 5,
  durationDays: 90,
  totalPrice: 290,
  tagline:
    'Validate the model in a few classrooms before scaling. It is most useful when you need to check operational fit and internal evidence with little risk.',
} as const;

export const ACTIVATION_STARTER = {
  name: 'Lightweight remote activation',
  classrooms: 2,
  totalPrice: 149,
  tagline:
    'Includes a technical checklist, one remote session with school IT, and support to leave 1-2 classrooms operational without assuming a full implementation.',
} as const;

export const PUBLIC_CAMPAIGN = {
  classrooms: 5,
  tagline:
    'No-cost access for up to 5 classrooms while availability lasts and public ownership is verified.',
} as const;

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Small school',
    rangeLabel: '1-10 classrooms',
    minClassrooms: 1,
    maxClassrooms: 10,
    pricePerClassroomPerYear: 55,
    approxPricePerDevicePerYear: 1.83,
    tagline: 'For first deployments or one teaching space with school-owned devices.',
    bestFor: 'First deployment or one teaching space with school-owned devices.',
  },
  {
    name: 'Medium school',
    rangeLabel: '11-25 classrooms',
    minClassrooms: 11,
    maxClassrooms: 25,
    pricePerClassroomPerYear: 45,
    approxPricePerDevicePerYear: 1.5,
    tagline: 'The most common tier for schools that already want a stable classroom policy.',
    bestFor: 'The most common tier for schools that already want a stable classroom policy.',
    recommended: true,
  },
  {
    name: 'Large school',
    rangeLabel: '26-50 classrooms',
    minClassrooms: 26,
    maxClassrooms: 50,
    pricePerClassroomPerYear: 37,
    approxPricePerDevicePerYear: 1.23,
    tagline: 'Designed for schools with several lines, labs, or staged growth.',
    bestFor: 'Schools with several lines, labs, or staged growth.',
  },
  {
    name: 'Educational organization',
    rangeLabel: '51-100 classrooms',
    minClassrooms: 51,
    maxClassrooms: 100,
    pricePerClassroomPerYear: 32,
    approxPricePerDevicePerYear: 1.07,
    tagline: 'For structures with central IT coordination and several sites or stages.',
    bestFor: 'For structures with central IT coordination and several sites or stages.',
  },
  {
    name: 'School network',
    rangeLabel: '101+ classrooms',
    minClassrooms: 101,
    maxClassrooms: null,
    pricePerClassroomPerYear: 27,
    approxPricePerDevicePerYear: 0.9,
    tagline: 'Optimized pricing for school networks and multi-site deployments.',
    bestFor: 'Optimized pricing for multi-site deployments and education networks.',
  },
];

export const ONBOARDING_TIERS: OnboardingTier[] = [
  {
    rangeLabel: 'Up to 25 classrooms',
    minClassrooms: 1,
    maxClassrooms: 25,
    oneTimeFee: 490,
  },
  {
    rangeLabel: '26-100 classrooms',
    minClassrooms: 26,
    maxClassrooms: 100,
    oneTimeFee: 890,
  },
  {
    rangeLabel: '101+ classrooms',
    minClassrooms: 101,
    maxClassrooms: null,
    oneTimeFee: null,
    label: 'Contact us',
  },
];

export function getIncludedPerClassroom(t: ClassroomPathT) {
  return [
    t('pricing.data.included.devices'),
    t('pricing.data.included.policies'),
    t('pricing.data.included.requests'),
    t('pricing.data.included.admin'),
    t('pricing.data.included.hosting'),
    t('pricing.data.included.updates'),
    t('pricing.data.included.support'),
    t('pricing.data.included.openpath'),
  ];
}

export function getNotIncludedBasePlan(t: ClassroomPathT) {
  return [
    t('pricing.data.notIncluded.sso'),
    t('pricing.data.notIncluded.sla'),
    t('pricing.data.notIncluded.migration'),
    t('pricing.data.notIncluded.training'),
    t('pricing.data.notIncluded.priority'),
    t('pricing.data.notIncluded.customPolicies'),
  ];
}

export function getValueBullets(t: ClassroomPathT) {
  return [
    t('pricing.data.value.public'),
    t('pricing.data.value.unit'),
    t('pricing.data.value.activation'),
    t('pricing.data.value.open'),
    t('pricing.data.value.noLockIn'),
  ];
}

export function getPerClassroomPoints(t: ClassroomPathT) {
  return [
    t('pricing.data.points.operation'),
    t('pricing.data.points.budget'),
    t('pricing.data.points.scale'),
    t('pricing.data.points.renewal'),
    t('pricing.data.points.service'),
  ];
}

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
