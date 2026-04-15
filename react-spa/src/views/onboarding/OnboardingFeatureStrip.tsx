import React from 'react';

const FEATURE_ITEMS = [
  {
    title: 'Open source en la base',
    text: 'OpenPath aporta un core auditable para la politica digital.',
  },
  {
    title: 'Flujos trazables',
    text: 'Invitaciones, aprobaciones y cambios siguen un proceso claro.',
  },
  {
    title: 'Produccion oficial en la UE',
    text: 'ClassroomPath esta alojado en servidores de la UE.',
  },
];

export function OnboardingFeatureStrip() {
  return (
    <div className="mb-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm md:grid-cols-3">
      {FEATURE_ITEMS.map((item) => (
        <div key={item.title}>
          <p className="font-semibold text-slate-900">{item.title}</p>
          <p className="mt-1">{item.text}</p>
        </div>
      ))}
    </div>
  );
}
