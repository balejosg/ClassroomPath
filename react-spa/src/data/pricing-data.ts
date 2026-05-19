import type { ClassroomPathT } from '../i18n/classroompath-i18n';
import type { ProductLocale } from '../openpath/public-i18n';

export type PricingTier = {
  nameKey: Parameters<ClassroomPathT>[0];
  rangeLabelKey: Parameters<ClassroomPathT>[0];
  minClassrooms: number;
  maxClassrooms: number | null;
  pricePerClassroomPerYear: number;
  approxPricePerDevicePerYear: number;
  taglineKey: Parameters<ClassroomPathT>[0];
  bestForKey: Parameters<ClassroomPathT>[0];
  recommended?: boolean;
};

export type OnboardingTier = {
  rangeLabelKey: Parameters<ClassroomPathT>[0];
  minClassrooms: number;
  maxClassrooms: number | null;
  oneTimeFee: number | null;
  labelKey?: Parameters<ClassroomPathT>[0];
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
    nameKey: 'pricing.tier.small.name',
    rangeLabelKey: 'pricing.tier.small.range',
    minClassrooms: 1,
    maxClassrooms: 10,
    pricePerClassroomPerYear: 55,
    approxPricePerDevicePerYear: 1.83,
    taglineKey: 'pricing.tier.small.tagline',
    bestForKey: 'pricing.tier.small.bestFor',
  },
  {
    nameKey: 'pricing.tier.medium.name',
    rangeLabelKey: 'pricing.tier.medium.range',
    minClassrooms: 11,
    maxClassrooms: 25,
    pricePerClassroomPerYear: 45,
    approxPricePerDevicePerYear: 1.5,
    taglineKey: 'pricing.tier.medium.tagline',
    bestForKey: 'pricing.tier.medium.bestFor',
    recommended: true,
  },
  {
    nameKey: 'pricing.tier.large.name',
    rangeLabelKey: 'pricing.tier.large.range',
    minClassrooms: 26,
    maxClassrooms: 50,
    pricePerClassroomPerYear: 37,
    approxPricePerDevicePerYear: 1.23,
    taglineKey: 'pricing.tier.large.tagline',
    bestForKey: 'pricing.tier.large.bestFor',
  },
  {
    nameKey: 'pricing.tier.organization.name',
    rangeLabelKey: 'pricing.tier.organization.range',
    minClassrooms: 51,
    maxClassrooms: 100,
    pricePerClassroomPerYear: 32,
    approxPricePerDevicePerYear: 1.07,
    taglineKey: 'pricing.tier.organization.tagline',
    bestForKey: 'pricing.tier.organization.bestFor',
  },
  {
    nameKey: 'pricing.tier.network.name',
    rangeLabelKey: 'pricing.tier.network.range',
    minClassrooms: 101,
    maxClassrooms: null,
    pricePerClassroomPerYear: 27,
    approxPricePerDevicePerYear: 0.9,
    taglineKey: 'pricing.tier.network.tagline',
    bestForKey: 'pricing.tier.network.bestFor',
  },
];

export const ONBOARDING_TIERS: OnboardingTier[] = [
  {
    rangeLabelKey: 'pricing.onboarding.tier.small.range',
    minClassrooms: 1,
    maxClassrooms: 25,
    oneTimeFee: 490,
  },
  {
    rangeLabelKey: 'pricing.onboarding.tier.medium.range',
    minClassrooms: 26,
    maxClassrooms: 100,
    oneTimeFee: 890,
  },
  {
    rangeLabelKey: 'pricing.onboarding.tier.large.range',
    minClassrooms: 101,
    maxClassrooms: null,
    oneTimeFee: null,
    labelKey: 'pricing.onboarding.tier.contact',
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

function toIntlLocale(locale: ProductLocale): string {
  return locale === 'es' ? 'es-ES' : 'en-US';
}

export function formatCurrency(value: number, locale: ProductLocale = 'es') {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPricePerDevice(value: number, locale: ProductLocale = 'es') {
  return new Intl.NumberFormat(toIntlLocale(locale), {
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
