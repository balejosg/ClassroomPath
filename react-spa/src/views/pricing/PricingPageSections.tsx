import React from 'react';
import { ArrowRight, Building2, Calculator, School, ShieldCheck } from 'lucide-react';

import { ContactForm } from '../../components/ContactForm';
import { FaqAccordion } from '../../components/FaqAccordion';
import { RevealSection } from '../../components/RevealSection';
import { getPricingFaqs } from '../../data/faqs';
import {
  ACTIVATION_STARTER,
  ONBOARDING_TIERS,
  PRICING_TIERS,
  PUBLIC_CAMPAIGN,
  formatCurrency,
  getIncludedPerClassroom,
  getNotIncludedBasePlan,
  getPerClassroomPoints,
  getPricingQuote,
  getValueBullets,
} from '../../data/pricing-data';
import { useClassroomPathI18n, useClassroomPathT } from '../../i18n/classroompath-i18n';

const exampleQuote = getPricingQuote(12);

function getNextStepCards(t: ReturnType<typeof useClassroomPathT>) {
  return [
    {
      icon: <Calculator size={18} className="text-sky-600" />,
      title: t('pricing.next.calculate.title'),
      text: t('pricing.next.calculate.text'),
      href: '#calculator',
      cta: t('pricing.next.calculate.cta'),
    },
    {
      icon: <School size={18} className="text-sky-600" />,
      title: t('pricing.next.activation.title'),
      text: t('pricing.next.activation.text'),
      href: '#activation',
      cta: t('pricing.next.activation.cta'),
    },
    {
      icon: <Building2 size={18} className="text-sky-600" />,
      title: t('pricing.next.demo.title'),
      text: t('pricing.next.demo.text'),
      href: '#request',
      cta: t('pricing.next.demo.cta'),
    },
  ];
}

function getOnboardingItems(t: ReturnType<typeof useClassroomPathT>) {
  return [
    t('pricing.onboarding.item.criteria'),
    t('pricing.onboarding.item.configuration'),
    t('pricing.onboarding.item.review'),
  ];
}

export function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
}

export function PricingPageHeader({ onNavigateToLogin }: { onNavigateToLogin: () => void }) {
  const t = useClassroomPathT();
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-5 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 shadow-lg shadow-sky-900/50">
              <ShieldCheck size={22} className="text-white" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight text-white">ClassroomPath</div>
              <div className="text-xs text-slate-400">{t('public.nav.tagline')}</div>
            </div>
          </a>

          <div className="flex items-center gap-3 sm:gap-5">
            <a
              href="/"
              className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
            >
              {t('public.nav.home')}
            </a>
            <a
              href="/login"
              onClick={(event) => {
                event.preventDefault();
                onNavigateToLogin();
              }}
              className="hidden text-sm font-medium text-slate-400 transition hover:text-white sm:inline"
            >
              {t('public.nav.access')}
            </a>
            <a
              href="#calculator"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
            >
              {t('public.nav.calculatePrice')}
            </a>
            <a
              href="#activation"
              className="hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 md:inline-flex"
            >
              {t('public.nav.requestActivation')}
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

export function PricingHero({
  recommendedTier,
}: {
  recommendedTier: (typeof PRICING_TIERS)[number];
}) {
  const { locale, t } = useClassroomPathI18n();
  return (
    <section className="relative overflow-hidden border-b border-white/10 bg-slate-900">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 34%), radial-gradient(circle at bottom right, rgba(14, 116, 144, 0.22), transparent 30%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-28 lg:pt-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">
            {t('pricing.hero.badge')}
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
            {t('pricing.hero.title')}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
            {t('pricing.hero.body')}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="#calculator"
              className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
            >
              {t('public.nav.calculatePrice')}
            </a>
            <a
              href="#activation"
              className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              {t('public.nav.requestActivation')}
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-300">
            <span>{t('pricing.hero.proof')}</span>
            <a href="#request" className="font-semibold text-sky-300 transition hover:text-sky-200">
              {t('pricing.hero.demo')}
            </a>
          </div>
        </div>

        <div className="grid gap-5 self-start">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
              {t('pricing.hero.recommended')}
            </div>
            <div className="mt-3 text-sm font-medium text-slate-300">
              {t('pricing.hero.mediumSchool')}
            </div>
            <div className="mt-2 text-4xl font-semibold text-white">
              {formatCurrency(recommendedTier.pricePerClassroomPerYear, locale)}
            </div>
            <div className="mt-1 text-sm text-slate-400">{t('pricing.hero.perClassroomYear')}</div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                <div className="text-sm text-slate-300">{t('pricing.hero.remoteActivation')}</div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {formatCurrency(ACTIVATION_STARTER.totalPrice, locale)}
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  {t('pricing.hero.activationLimit', { classrooms: ACTIVATION_STARTER.classrooms })}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                <div className="text-sm text-slate-300">{t('pricing.hero.onboarding')}</div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {t('pricing.hero.onboardingPrice')}
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  {t('pricing.hero.onboardingBody')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PricingNextStepsSection() {
  const t = useClassroomPathT();
  const nextStepCards = getNextStepCards(t);
  return (
    <RevealSection id="next-step" className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('pricing.next.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-600">{t('pricing.next.body')}</p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {nextStepCards.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                {item.icon}
              </div>
              <div className="text-lg font-semibold text-slate-900">{item.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
              <a
                href={item.href}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-sky-700 transition hover:text-sky-600"
              >
                {item.cta} <ArrowRight size={16} />
              </a>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

export function PricingIncludedSection() {
  const t = useClassroomPathT();
  const includedPerClassroom = getIncludedPerClassroom(t);
  return (
    <RevealSection className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('pricing.included.label')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('pricing.included.title')}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {includedPerClassroom.map((item) => (
              <div
                key={item}
                className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium leading-7 text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-5 self-start">
          <a
            href="/#centros-publicos"
            className="group block rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-6 py-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                  {t('pricing.campaign.label')}
                </div>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">
                  {t('pricing.campaign.title')}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {t('pricing.campaign.body', { classrooms: PUBLIC_CAMPAIGN.classrooms })}
                </p>
              </div>
              <ArrowRight
                size={20}
                className="shrink-0 text-emerald-600 transition group-hover:translate-x-1"
              />
            </div>
          </a>

          <div
            id="activation"
            className="rounded-2xl border border-sky-200 bg-sky-50 px-6 py-7 shadow-sm"
          >
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              {t('pricing.hero.remoteActivation')}
            </div>
            <h3 className="mt-3 text-2xl font-semibold text-slate-900">
              {t('pricing.activation.title')}
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-700">{t('pricing.activation.body')}</p>
            <a
              href="#request"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t('public.nav.requestActivation')} <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

export function PricingTiersSection() {
  const { locale, t } = useClassroomPathI18n();
  return (
    <RevealSection id="pricing" className="bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('pricing.tiers.label')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('pricing.tiers.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-600">{t('pricing.tiers.body')}</p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.nameKey}
              className={`rounded-[2rem] border p-6 shadow-sm ${
                tier.recommended
                  ? 'border-sky-300 bg-white ring-1 ring-inset ring-sky-200'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  {t(tier.rangeLabelKey)}
                </div>
                {tier.recommended ? (
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                    {t('pricing.tiers.recommended')}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">{t(tier.nameKey)}</h3>
              <div className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
                {formatCurrency(tier.pricePerClassroomPerYear, locale)}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {t('pricing.hero.perClassroomYear')}
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-600">{t(tier.taglineKey)}</p>
              <p className="mt-4 text-sm leading-7 text-slate-500">{t(tier.bestForKey)}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-sm text-slate-500">{t('pricing.tiers.footer')}</p>
      </div>
    </RevealSection>
  );
}

export function PricingOnboardingSection() {
  const { locale, t } = useClassroomPathI18n();
  const onboardingItems = getOnboardingItems(t);
  const valueBullets = getValueBullets(t);
  return (
    <RevealSection id="onboarding" className="border-y border-slate-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div className="rounded-[2rem] border border-slate-200 bg-slate-50 px-6 py-7 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('pricing.hero.onboarding')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('pricing.onboarding.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-600">{t('pricing.onboarding.body')}</p>
          <div className="mt-8">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t('pricing.onboarding.covers')}
            </div>
            <div className="mt-4 grid gap-3">
              {onboardingItems.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm leading-7 text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {ONBOARDING_TIERS.map((tier) => (
              <div key={tier.rangeLabelKey} className="rounded-xl bg-white px-4 py-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">{t(tier.rangeLabelKey)}</div>
                <div className="mt-3 text-2xl font-semibold text-slate-950">
                  {tier.oneTimeFee === null
                    ? t(tier.labelKey ?? 'pricing.onboarding.tier.contact')
                    : formatCurrency(tier.oneTimeFee, locale)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('pricing.value.label')}
          </div>
          <div className="mt-6 space-y-4">
            {valueBullets.map((item) => (
              <div
                key={item}
                className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

export function PricingCalculatorSection(props: {
  classroomsInput: string;
  classroomsInputId: string;
  quote: ReturnType<typeof getPricingQuote>;
  onClassroomsInputChange: (value: string) => void;
}) {
  const { classroomsInput, classroomsInputId, onClassroomsInputChange, quote } = props;
  const { locale, t } = useClassroomPathI18n();

  return (
    <section id="calculator" className="border-y border-slate-200 bg-slate-900 text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
            <Calculator size={16} />
            {t('pricing.calculator.label')}
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {t('pricing.calculator.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-300">{t('pricing.calculator.body')}</p>

          <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <label
              htmlFor={classroomsInputId}
              className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-200"
            >
              {t('pricing.calculator.classrooms')}
            </label>
            <input
              id={classroomsInputId}
              type="number"
              min="1"
              step="1"
              value={classroomsInput}
              onChange={(event) => onClassroomsInputChange(event.target.value)}
              className="mt-4 w-full rounded-xl border border-white/10 bg-slate-800 px-5 py-4 text-3xl font-semibold text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
            />
            <p className="mt-3 text-sm leading-7 text-slate-400">
              {t('pricing.calculator.classroomHelp')}
            </p>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
            {t('pricing.calculator.estimate')}
          </div>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                {t('pricing.calculator.appliedTier')}
              </div>
              <div className="mt-3 text-3xl font-semibold text-white">{t(quote.tier.nameKey)}</div>
              <p className="mt-2 text-sm leading-7 text-slate-300">{t(quote.tier.taglineKey)}</p>
            </div>
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
              {t('pricing.calculator.classroomLine', {
                classrooms: quote.classrooms,
                price: formatCurrency(quote.tier.pricePerClassroomPerYear, locale),
              })}
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
              <div className="text-sm text-slate-400">{t('pricing.calculator.annualFee')}</div>
              <div className="mt-2 text-3xl font-semibold text-white">
                {formatCurrency(quote.annualTotal, locale)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
              <div className="text-sm text-slate-400">{t('pricing.hero.onboarding')}</div>
              <div className="mt-2 text-3xl font-semibold text-white">
                {quote.onboardingFee === null
                  ? t(quote.onboardingTier.labelKey ?? 'pricing.onboarding.tier.contact')
                  : formatCurrency(quote.onboardingFee, locale)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
              <div className="text-sm text-slate-400">{t('pricing.calculator.totalFirstYear')}</div>
              <div className="mt-2 text-3xl font-semibold text-white">
                {quote.totalFirstYear === null
                  ? t(quote.onboardingTier.labelKey ?? 'pricing.onboarding.tier.contact')
                  : formatCurrency(quote.totalFirstYear, locale)}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-7 text-slate-300">
            {t('pricing.calculator.example', {
              annualTotal: formatCurrency(exampleQuote.annualTotal, locale),
              onboarding: formatCurrency(exampleQuote.onboardingFee ?? 0, locale),
              price: formatCurrency(exampleQuote.tier.pricePerClassroomPerYear, locale),
              total: formatCurrency(exampleQuote.totalFirstYear ?? 0, locale),
            })}
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-7 text-slate-300">
            {quote.onboardingFee === null
              ? t('pricing.calculator.customOnboarding')
              : t('pricing.calculator.onboardingTier', {
                  classrooms: quote.classrooms,
                  rangeLabel: t(quote.onboardingTier.rangeLabelKey).toLowerCase(),
                })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PricingModelSection() {
  const t = useClassroomPathT();
  const perClassroomPoints = getPerClassroomPoints(t);
  const valueBullets = getValueBullets(t);
  return (
    <RevealSection className="bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-2 lg:px-8">
        <div className="rounded-[2rem] border border-slate-200 bg-slate-50 px-6 py-7 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('pricing.model.label')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('pricing.model.title')}
          </h2>
          <div className="mt-8 space-y-4">
            {perClassroomPoints.map((item) => (
              <div
                key={item}
                className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm leading-7 text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('pricing.model.commercial')}
          </div>
          <h3 className="mt-4 text-2xl font-semibold text-slate-900">{t('pricing.value.label')}</h3>
          <div className="mt-6 space-y-4">
            {valueBullets.map((item) => (
              <div key={item} className="rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

export function PricingNotIncludedSection() {
  const t = useClassroomPathT();
  const notIncludedBasePlan = getNotIncludedBasePlan(t);
  return (
    <RevealSection className="border-y border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('pricing.notIncluded.label')}
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            {t('pricing.notIncluded.title')}
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">{t('pricing.notIncluded.body')}</p>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {notIncludedBasePlan.map((item) => (
            <div
              key={item}
              className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600"
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

export function PricingContactSection({ onNavigateToLogin }: { onNavigateToLogin: () => void }) {
  const t = useClassroomPathT();
  return (
    <section id="request" className="bg-slate-50 py-20">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="rounded-[2.25rem] border border-sky-100 bg-white px-8 py-14 shadow-lg shadow-sky-100/60">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
              <ShieldCheck size={32} className="text-sky-600" />
            </div>
            <div className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              {t('public.contact.requestLabel')}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              {t('pricing.contact.title')}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
              {t('pricing.contact.body')}
            </p>
          </div>
          <div className="mx-auto mt-10 max-w-2xl">
            <ContactForm />
          </div>
          <p className="mt-8 text-center text-xs leading-6 text-slate-400">
            {t('public.contact.loginPrompt')}{' '}
            <a
              href="/login"
              onClick={(event) => {
                event.preventDefault();
                onNavigateToLogin();
              }}
              className="underline transition hover:text-slate-600"
            >
              {t('app.common.openDashboard')}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

export function PricingFaqSection() {
  const t = useClassroomPathT();
  return (
    <FaqAccordion
      items={getPricingFaqs(t)}
      sectionLabel={t('public.faq.label')}
      sectionTitle={t('public.faq.pricingTitle')}
    />
  );
}
