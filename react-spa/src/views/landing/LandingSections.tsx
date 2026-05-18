import { ShieldCheck } from 'lucide-react';

import { ContactForm } from '../../components/ContactForm';
import { RevealSection } from '../../components/RevealSection';
import { useClassroomPathT } from '../../i18n/classroompath-i18n';
import {
  getFitSignals,
  getPracticalSteps,
  getQuickBenefits,
  getRoleBenefits,
} from './LandingSectionData';

interface LandingLoginLinkProps {
  onNavigateToLogin: () => void;
  className?: string;
  children: React.ReactNode;
}

interface LandingCallToActionProps {
  onNavigateToLogin: () => void;
}

function LandingLoginLink({ onNavigateToLogin, className, children }: LandingLoginLinkProps) {
  return (
    <a
      href="/login"
      onClick={(event) => {
        event.preventDefault();
        onNavigateToLogin();
      }}
      className={className}
    >
      {children}
    </a>
  );
}

export function LandingHeroSection({ onNavigateToLogin }: LandingCallToActionProps) {
  const t = useClassroomPathT();
  return (
    <section className="relative overflow-hidden bg-slate-900">
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-28">
        <div className="max-w-3xl">
          <div className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-300">
            {t('landing.hero.badge')}
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
            {t('landing.hero.title')}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            {t('landing.hero.body')}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="/pricing"
              className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
            >
              {t('public.nav.calculatePrice')}
            </a>
            <a
              href="#request"
              className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              {t('public.nav.requestActivation')}
            </a>
          </div>
          <p className="mt-6 text-sm text-slate-300">{t('landing.hero.proof')}</p>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
            {t('landing.hero.cardLabel')}
          </div>
          <div className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
            <p>{t('landing.hero.card1')}</p>
            <p>{t('landing.hero.card2')}</p>
            <p>{t('landing.hero.card3')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingQuickBenefitsSection() {
  const t = useClassroomPathT();
  const quickBenefits = getQuickBenefits(t);
  return (
    <RevealSection className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {quickBenefits.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
            >
              <div className="text-lg font-semibold text-slate-900">{item.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

export function LandingPositioningSection() {
  const t = useClassroomPathT();
  return (
    <RevealSection className="bg-slate-900 text-white">
      <div className="mx-auto max-w-5xl px-6 py-16 text-center lg:px-8">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('landing.positioning.title')}
        </h2>
        <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-slate-300">
          {t('landing.positioning.body')}
        </p>
      </div>
    </RevealSection>
  );
}

export function LandingPracticalFlowSection() {
  const t = useClassroomPathT();
  const practicalSteps = getPracticalSteps(t);
  return (
    <RevealSection className="bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('landing.flow.label')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('landing.flow.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-600">{t('landing.flow.body')}</p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {practicalSteps.map((item) => (
            <div
              key={item.step}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                {item.step}
              </div>
              <div className="mt-3 text-xl font-semibold text-slate-900">{item.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

export function LandingRoleBenefitsSection() {
  const t = useClassroomPathT();
  const roleBenefits = getRoleBenefits(t);
  return (
    <RevealSection className="border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('landing.roles.label')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('landing.roles.title')}
          </h2>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {roleBenefits.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                <Icon size={20} className="text-sky-600" />
              </div>
              <div className="text-lg font-semibold text-slate-900">{title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

export function LandingFitSection() {
  const t = useClassroomPathT();
  const fitSignals = getFitSignals(t);
  return (
    <RevealSection className="bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            {t('landing.fit.label')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('landing.fit.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-600">{t('landing.fit.body')}</p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {fitSignals.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                <Icon size={20} className="text-sky-600" />
              </div>
              <div className="text-lg font-semibold text-slate-900">{title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

export function LandingPublicCampaignSection() {
  const t = useClassroomPathT();
  return (
    <RevealSection
      id="centros-publicos"
      className="relative overflow-hidden border-y border-emerald-200 bg-emerald-50"
    >
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(#065f46 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 py-16 lg:px-8">
        <div className="rounded-[2rem] border border-emerald-200 bg-white/80 px-8 py-10 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
            {t('landing.campaign.badge')}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {t('landing.campaign.title')}
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-700">{t('landing.campaign.body')}</p>
          <div className="mt-6 space-y-2 text-sm text-slate-700">
            <p>{t('landing.campaign.detail1')}</p>
            <p>{t('landing.campaign.detail2')}</p>
            <p>{t('landing.campaign.detail3')}</p>
          </div>
          <a
            href="mailto:hola@classroompath.com?subject=Consulta%20disponibilidad%20centro%20p%C3%BAblico"
            className="mt-8 inline-flex rounded-lg bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            {t('landing.campaign.cta')}
          </a>
        </div>
      </div>
    </RevealSection>
  );
}

export function LandingRequestSection({ onNavigateToLogin }: LandingCallToActionProps) {
  const t = useClassroomPathT();
  return (
    <section id="request" className="bg-slate-50 pb-24 pt-20">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="rounded-2xl border border-sky-100 bg-white px-8 py-16 shadow-lg">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
              <ShieldCheck size={32} className="text-sky-600" />
            </div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              {t('public.contact.requestLabel')}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              {t('landing.request.title')}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
              {t('landing.request.body')}
            </p>
          </div>
          <div className="mx-auto mt-10 max-w-2xl">
            <ContactForm />
          </div>
          <p className="mt-8 text-center text-xs text-slate-400">
            {t('public.contact.loginPrompt')}{' '}
            <LandingLoginLink
              onNavigateToLogin={onNavigateToLogin}
              className="underline transition hover:text-slate-600"
            >
              {t('app.common.openDashboard')}
            </LandingLoginLink>
          </p>
        </div>
      </div>
    </section>
  );
}
