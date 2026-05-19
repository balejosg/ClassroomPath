import React from 'react';

import { useClassroomPathT } from '../../i18n/classroompath-i18n';

const FEATURE_ITEMS = [
  {
    titleKey: 'onboarding.feature.open.title',
    textKey: 'onboarding.feature.open.text',
  },
  {
    titleKey: 'onboarding.feature.flows.title',
    textKey: 'onboarding.feature.flows.text',
  },
  {
    titleKey: 'onboarding.feature.eu.title',
    textKey: 'onboarding.feature.eu.text',
  },
] as const;

export function OnboardingFeatureStrip() {
  const t = useClassroomPathT();

  return (
    <div className="mb-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm md:grid-cols-3">
      {FEATURE_ITEMS.map((item) => (
        <div key={item.titleKey}>
          <p className="font-semibold text-slate-900">{t(item.titleKey)}</p>
          <p className="mt-1">{t(item.textKey)}</p>
        </div>
      ))}
    </div>
  );
}
