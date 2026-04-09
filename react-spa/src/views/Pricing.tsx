import React from 'react';
import { ArrowRight, Building2, Calculator, School, ShieldCheck } from 'lucide-react';

import { ContactForm } from '../components/ContactForm';
import { FaqAccordion } from '../components/FaqAccordion';
import { RevealSection } from '../components/RevealSection';
import { SharedFooter } from '../components/SharedFooter';
import { PRICING_FAQS } from '../data/faqs';
import {
  INCLUDED_PER_CLASSROOM,
  NOT_INCLUDED_BASE_PLAN,
  ONBOARDING_TIERS,
  PER_CLASSROOM_POINTS,
  PILOT,
  PRICING_TIERS,
  PUBLIC_CAMPAIGN,
  VALUE_BULLETS,
  formatCurrency,
  getPricingQuote,
} from '../data/pricing-data';

export { getPricingQuote } from '../data/pricing-data';

interface ClassroomPathPricingPageProps {
  onNavigateToLogin: () => void;
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
}

const nextStepCards = [
  {
    icon: <Calculator size={18} className="text-sky-600" />,
    title: 'Calcular presupuesto',
    text: 'Si necesitas una cifra rápida para presupuesto, usa la calculadora y obtén una estimación del primer año.',
    href: '#calculator',
    cta: 'Ir a calculadora',
  },
  {
    icon: <School size={18} className="text-sky-600" />,
    title: 'Empezar con un piloto',
    text: 'Si necesitas evidencias internas antes de contratar, valida el modelo en 5 aulas durante 90 días.',
    href: '#pilot',
    cta: 'Ver piloto',
  },
  {
    icon: <Building2 size={18} className="text-sky-600" />,
    title: 'Solicitar demo',
    text: 'Si ya estás comparando opciones, revisamos política, alcance y despliegue contigo.',
    href: '#solicitud',
    cta: 'Solicitar demo',
  },
];

const onboardingItems = [
  'Sesión de arranque y definición de criterio',
  'Configuración inicial y primer despliegue guiado',
  'Revisión del arranque y siguientes pasos',
];

const exampleQuote = getPricingQuote(12);

export function ClassroomPathPricingPage({ onNavigateToLogin }: ClassroomPathPricingPageProps) {
  const [classroomsInput, setClassroomsInput] = React.useState('12');
  const classroomsInputId = React.useId();
  const parsedClassrooms = parsePositiveInteger(classroomsInput);
  const quote = getPricingQuote(parsedClassrooms ?? 12);
  const recommendedTier = PRICING_TIERS.find((tier) => tier.recommended) ?? PRICING_TIERS[1];

  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-5 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 shadow-lg shadow-sky-900/50">
                <ShieldCheck size={22} className="text-white" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white">
                  ClassroomPath
                </div>
                <div className="text-xs text-slate-400">Filtrado web escolar por aula</div>
              </div>
            </a>

            <div className="flex items-center gap-3 sm:gap-5">
              <a
                href="/"
                className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
              >
                Inicio
              </a>
              <a
                href="/login"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigateToLogin();
                }}
                className="hidden text-sm font-medium text-slate-400 transition hover:text-white sm:inline"
              >
                Acceder
              </a>
              <a
                href="#calculator"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
              >
                Calcular precio
              </a>
              <a
                href="#pilot"
                className="hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 md:inline-flex"
              >
                Empezar piloto
              </a>
            </div>
          </div>
        </div>
      </header>

      <main>
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
                Precios públicos por aula · sin sorpresas
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Calcula el primer año en segundos y decide el siguiente paso.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                Primer año = cuota anual por aula + onboarding único. Desde el segundo año, solo
                mantienes la cuota anual por aula. Si necesitas reducir riesgo interno, empieza con
                un piloto antes de escalar.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="#calculator"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
                >
                  Calcular precio
                </a>
                <a
                  href="#pilot"
                  className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Empezar piloto
                </a>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-300">
                <span>
                  Hasta 30 dispositivos por aula · piloto de 90 días · servicio gestionado sobre
                  OpenPath
                </span>
                <a
                  href="#solicitud"
                  className="font-semibold text-sky-300 transition hover:text-sky-200"
                >
                  Solicitar demo
                </a>
              </div>
            </div>

            <div className="grid gap-5 self-start">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Tramo más habitual
                </div>
                <div className="mt-3 text-sm font-medium text-slate-300">Centro mediano</div>
                <div className="mt-2 text-4xl font-semibold text-white">
                  {formatCurrency(recommendedTier.pricePerClassroomPerYear)}
                </div>
                <div className="mt-1 text-sm text-slate-400">por aula / año</div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm text-slate-300">Piloto</div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {formatCurrency(PILOT.totalPrice)}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {PILOT.classrooms} aulas durante {PILOT.durationDays} días
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm text-slate-300">Onboarding</div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      Separado · desde 490 €
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      Lo esencial para controlar el acceso por aula, sin módulos que no vas a usar.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <RevealSection id="next-step" className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Qué paso te conviene ahora
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                Cada centro llega con una necesidad distinta. Elige el recorrido que mejor te
                convenga ahora.
              </p>
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

        <RevealSection className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Qué incluye cada aula
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Un servicio gestionado para ordenar el acceso a Internet sin cargar más al equipo
                TIC
              </h2>
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {INCLUDED_PER_CLASSROOM.map((item) => (
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
                      Campaña activa
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-slate-900">
                      Acceso inicial para centros públicos
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Hasta {PUBLIC_CAMPAIGN.classrooms} aulas sin coste. Plazas limitadas.
                    </p>
                  </div>
                  <ArrowRight
                    size={20}
                    className="shrink-0 text-emerald-600 transition group-hover:translate-x-1"
                  />
                </div>
              </a>

              <div
                id="pilot"
                className="rounded-2xl border border-sky-200 bg-sky-50 px-6 py-7 shadow-sm"
              >
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Piloto
                </div>
                <h3 className="mt-3 text-2xl font-semibold text-slate-900">
                  5 aulas durante 90 días por 290 €
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-700">{PILOT.tagline}</p>
                <a
                  href="#solicitud"
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Solicitar piloto <ArrowRight size={16} />
                </a>
              </div>
            </div>
          </div>
        </RevealSection>

        <RevealSection id="pricing" className="bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Tramos de precio
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Un precio por aula. Más aulas, menos coste por cada una.
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                ClassroomPath cobra por aula controlada, no por licencias sueltas. Así el centro
                entiende el coste rápido, identifica el tramo habitual y sabe cuándo necesita una
                validación comercial más específica.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              {PRICING_TIERS.map((tier) => (
                <div
                  key={tier.name}
                  className={`rounded-[2rem] border p-6 shadow-sm ${
                    tier.recommended
                      ? 'border-sky-300 bg-white ring-1 ring-inset ring-sky-200'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                      {tier.rangeLabel}
                    </div>
                    {tier.recommended ? (
                      <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                        Más habitual
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-900">{tier.name}</h3>
                  <div className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
                    {formatCurrency(tier.pricePerClassroomPerYear)}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">por aula / año</div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{tier.tagline}</p>
                  <p className="mt-4 text-sm leading-7 text-slate-500">{tier.bestFor}</p>
                </div>
              ))}
            </div>

            <p className="mt-5 text-sm text-slate-500">
              Todos los tramos requieren onboarding inicial. IVA no incluido.
            </p>
          </div>
        </RevealSection>

        <RevealSection id="onboarding" className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
            <div className="rounded-[2rem] border border-slate-200 bg-slate-50 px-6 py-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Onboarding
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Onboarding separado para que la renovación sea clara
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                Separamos el arranque del recurrente para que el centro compare mejor el coste anual
                por aula y vea el esfuerzo inicial por separado.
              </p>
              <div className="mt-8">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Qué cubre el onboarding
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
                  <div key={tier.rangeLabel} className="rounded-xl bg-white px-4 py-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-900">{tier.rangeLabel}</div>
                    <div className="mt-3 text-2xl font-semibold text-slate-950">
                      {tier.oneTimeFee === null ? tier.label : formatCurrency(tier.oneTimeFee)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Por qué este modelo se entiende más rápido
              </div>
              <div className="mt-6 space-y-4">
                {VALUE_BULLETS.map((item) => (
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

        <section id="calculator" className="border-y border-slate-200 bg-slate-900 text-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
                <Calculator size={16} />
                Calculadora
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Estima el coste del primer año en 10 segundos
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                Introduce el número de aulas y verás: tramo aplicado, cuota anual, onboarding y
                total del primer año antes de pedir una propuesta detallada.
              </p>

              <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/5 p-6">
                <label
                  htmlFor={classroomsInputId}
                  className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-200"
                >
                  Número de aulas
                </label>
                <input
                  id={classroomsInputId}
                  type="number"
                  min="1"
                  step="1"
                  value={classroomsInput}
                  onChange={(event) => setClassroomsInput(event.target.value)}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-slate-800 px-5 py-4 text-3xl font-semibold text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
                />
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Aula controlada = hasta 30 dispositivos bajo una política de acceso definida.
                </p>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                Estimación del primer año
              </div>
              <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                    Tramo aplicado
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-white">{quote.tier.name}</div>
                  <p className="mt-2 text-sm leading-7 text-slate-300">{quote.tier.tagline}</p>
                </div>
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
                  {quote.classrooms} aulas x {formatCurrency(quote.tier.pricePerClassroomPerYear)}
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
                  <div className="text-sm text-slate-400">Cuota anual</div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {formatCurrency(quote.annualTotal)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
                  <div className="text-sm text-slate-400">Onboarding</div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {quote.onboardingFee === null
                      ? quote.onboardingTier.label
                      : formatCurrency(quote.onboardingFee)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
                  <div className="text-sm text-slate-400">Total primer año</div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {quote.totalFirstYear === null
                      ? quote.onboardingTier.label
                      : formatCurrency(quote.totalFirstYear)}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-7 text-slate-300">
                Ejemplo: 12 aulas x {formatCurrency(exampleQuote.tier.pricePerClassroomPerYear)} ={' '}
                {formatCurrency(exampleQuote.annualTotal)} / año · Onboarding:{' '}
                {formatCurrency(exampleQuote.onboardingFee ?? 0)} · Total primer año:{' '}
                {formatCurrency(exampleQuote.totalFirstYear ?? 0)}
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-7 text-slate-300">
                {quote.onboardingFee === null
                  ? 'En despliegues de 101 aulas o más, el onboarding se define con una propuesta específica por sede, alcance y ritmo de implantación.'
                  : `El onboarding para ${quote.classrooms} aulas queda en el tramo ${quote.onboardingTier.rangeLabel.toLowerCase()}.`}
              </div>
            </div>
          </div>
        </section>

        <RevealSection className="bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-2 lg:px-8">
            <div className="rounded-[2rem] border border-slate-200 bg-slate-50 px-6 py-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Por qué cobramos por aula
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Un precio más cercano a la realidad operativa del centro
              </h2>
              <div className="mt-8 space-y-4">
                {PER_CLASSROOM_POINTS.map((item) => (
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
                Modelo comercial
              </div>
              <h3 className="mt-4 text-2xl font-semibold text-slate-900">
                Por qué este modelo se entiende más rápido
              </h3>
              <div className="mt-6 space-y-4">
                {VALUE_BULLETS.map((item) => (
                  <div
                    key={item}
                    className="rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </RevealSection>

        <RevealSection className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Transparencia del plan base
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
                Lo que no está incluido en el recurrente estándar
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Estas funcionalidades están disponibles, pero se presupuestan aparte para no
                encarecer el plan base a quienes no las necesitan.
              </p>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {NOT_INCLUDED_BASE_PLAN.map((item) => (
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

        <FaqAccordion
          items={PRICING_FAQS}
          sectionLabel="FAQ"
          sectionTitle="Respuestas directas para evaluación institucional"
        />

        <section id="solicitud" className="bg-slate-50 py-20">
          <div className="mx-auto max-w-5xl px-6 lg:px-8">
            <div className="rounded-[2.25rem] border border-sky-100 bg-white px-8 py-14 shadow-lg shadow-sky-100/60">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
                  <ShieldCheck size={32} className="text-sky-600" />
                </div>
                <div className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Solicitar presupuesto, piloto o demo
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                  Pide presupuesto, piloto o revisión de despliegue
                </h2>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
                  Revisamos el número de aulas, la política de acceso prevista y el siguiente paso
                  recomendado para tu centro o red de centros. Respondemos en 48 h.
                </p>
              </div>
              <div className="mx-auto mt-10 max-w-2xl">
                <ContactForm />
              </div>
              <p className="mt-8 text-center text-xs leading-6 text-slate-400">
                ¿Ya tienes cuenta?{' '}
                <a
                  href="/login"
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigateToLogin();
                  }}
                  className="underline transition hover:text-slate-600"
                >
                  Acceder al panel
                </a>
              </p>
            </div>
          </div>
        </section>
      </main>

      <SharedFooter />
    </div>
  );
}
