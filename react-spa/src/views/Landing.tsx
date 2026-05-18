import { ShieldCheck } from 'lucide-react';

import { FaqAccordion } from '../components/FaqAccordion';
import { SharedFooter } from '../components/SharedFooter';
import { getLandingFaqs } from '../data/faqs';
import { useClassroomPathT } from '../i18n/classroompath-i18n';
import {
  LandingFitSection,
  LandingHeroSection,
  LandingPositioningSection,
  LandingPracticalFlowSection,
  LandingPublicCampaignSection,
  LandingQuickBenefitsSection,
  LandingRequestSection,
  LandingRoleBenefitsSection,
} from './landing/LandingSections';

interface ClassroomPathLandingPageProps {
  onNavigateToLogin: () => void;
}

export function ClassroomPathLandingPage({ onNavigateToLogin }: ClassroomPathLandingPageProps) {
  const t = useClassroomPathT();
  const landingFaqs = getLandingFaqs(t);

  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-5 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 shadow-lg shadow-sky-900/50">
                <ShieldCheck size={22} className="text-white" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white">
                  ClassroomPath
                </div>
                <div className="text-xs text-slate-400">{t('public.nav.tagline')}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-5">
              <a
                href="/pricing"
                className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
              >
                {t('public.nav.pricing')}
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
                href="/pricing"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
              >
                {t('public.nav.calculatePrice')}
              </a>
              <a
                href="#request"
                className="hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 md:inline-flex"
              >
                {t('public.nav.requestActivation')}
              </a>
            </div>
          </div>
        </div>
      </header>

      <main>
        <LandingHeroSection onNavigateToLogin={onNavigateToLogin} />
        <LandingQuickBenefitsSection />
        <LandingPositioningSection />
        <LandingPracticalFlowSection />
        <LandingRoleBenefitsSection />
        <LandingFitSection />
        <LandingPublicCampaignSection />
        <FaqAccordion
          items={landingFaqs}
          sectionLabel={t('public.faq.label')}
          sectionTitle={t('public.faq.landingTitle')}
        />
        <LandingRequestSection onNavigateToLogin={onNavigateToLogin} />
      </main>

      <SharedFooter />
    </div>
  );
}
