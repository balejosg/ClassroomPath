import { translateClassroomPathText, type ClassroomPathT } from '../i18n/classroompath-i18n';

export type FaqItem = {
  q: string;
  a: string;
};

export function getLandingFaqs(t: ClassroomPathT): FaqItem[] {
  return [
    {
      q: t('faq.landing.screenTime.q'),
      a: t('faq.landing.screenTime.a'),
    },
    {
      q: t('faq.landing.filter.q'),
      a: t('faq.landing.filter.a'),
    },
    {
      q: t('faq.landing.openSource.q'),
      a: t('faq.landing.openSource.a'),
    },
    {
      q: t('faq.landing.fit.q'),
      a: t('faq.landing.fit.a'),
    },
    {
      q: t('faq.landing.time.q'),
      a: t('faq.landing.time.a'),
    },
  ];
}

export const LANDING_FAQS = getLandingFaqs((key, params) =>
  translateClassroomPathText('en', key, params)
);

export function getPricingFaqs(t: ClassroomPathT): FaqItem[] {
  return [
    {
      q: t('faq.pricing.classroom.q'),
      a: t('faq.pricing.classroom.a'),
    },
    {
      q: t('faq.pricing.activation.q'),
      a: t('faq.pricing.activation.a'),
    },
    {
      q: t('faq.pricing.onboarding.q'),
      a: t('faq.pricing.onboarding.a'),
    },
    {
      q: t('faq.pricing.unit.q'),
      a: t('faq.pricing.unit.a'),
    },
    {
      q: t('faq.pricing.largeClassroom.q'),
      a: t('faq.pricing.largeClassroom.a'),
    },
    {
      q: t('faq.pricing.support.q'),
      a: t('faq.pricing.support.a'),
    },
    {
      q: t('faq.pricing.public.q'),
      a: t('faq.pricing.public.a'),
    },
    {
      q: t('faq.pricing.difference.q'),
      a: t('faq.pricing.difference.a'),
    },
  ];
}

export const PRICING_FAQS = getPricingFaqs((key, params) =>
  translateClassroomPathText('en', key, params)
);
