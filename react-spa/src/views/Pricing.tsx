import React from 'react';
import {
  ArrowRight,
  Calculator,
  ShieldCheck,
  Code2,
  Unlock,
  School,
  Building2,
} from 'lucide-react';

import { SharedFooter } from '../components/SharedFooter';
import { FaqAccordion } from '../components/FaqAccordion';
import { ContactForm } from '../components/ContactForm';
import { RevealSection } from '../components/RevealSection';
import { PRICING_FAQS } from '../data/faqs';
import {
  PILOT,
  PUBLIC_CAMPAIGN,
  PRICING_TIERS,
  ONBOARDING_TIERS,
  INCLUDED_PER_CLASSROOM,
  NOT_INCLUDED_BASE_PLAN,
  VALUE_BULLETS,
  PER_CLASSROOM_POINTS,
  COMPETITIVE_CLAIMS,
  MARKET_BENCHMARKS,
  formatCurrency,
  formatPricePerDevice,
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
    title: 'Calcular',
    text: 'Si necesitas presupuesto, calcula el tramo por aulas y obtén una estimación del primer año.',
    href: '#calculator',
    cta: 'Ir a calculadora',
  },
  {
    icon: <School size={18} className="text-sky-600" />,
    title: 'Piloto',
    text: 'Si necesitas evidencias internas, empieza por 5 aulas durante 90 días antes de escalar.',
    href: '#pilot',
    cta: 'Ver piloto',
  },
  {
    icon: <Building2 size={18} className="text-sky-600" />,
    title: 'Demo',
    text: 'Si ya estás comparando opciones, agenda una demo para revisar política, alcance y despliegue.',
    href: '#demo',
    cta: 'Solicitar demo',
  },
];

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a href="/" className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 shadow-lg shadow-sky-900/50">
                  <ShieldCheck size={22} className="text-white" />
                </div>
                <div>
                  <div className="text-base font-semibold tracking-tight text-white">
                    ClassroomPath
                  </div>
                  <div className="text-xs text-slate-400">
                    Filtrado web escolar · Código abierto
                  </div>
                </div>
              </a>
            </div>
            <div className="flex items-center gap-5">
              <a
                href="/"
                className="text-sm font-medium text-slate-300 transition hover:text-white"
              >
                ← Inicio
              </a>
              <a
                href="/login"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigateToLogin();
                }}
                className="hidden text-sm text-slate-400 transition hover:text-white sm:inline"
              >
                Acceder
              </a>
              <a
                href="#demo"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
              >
                Solicitar demo
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
                Precios por aula · Sin sorpresas
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Calcula el coste por aula y elige el siguiente paso.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                Un precio por aula al año, fácil de explicar en un presupuesto. El onboarding va
                aparte para que el coste anual sea siempre el mismo.
              </p>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
                Si necesitas una cifra rápida, usa la calculadora. Si necesitas reducir riesgo
                interno, empieza por un piloto. Si ya estás evaluando despliegue, pide una demo.
              </p>
              <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-200">
                {VALUE_BULLETS.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2"
                  >
                    {item}
                  </span>
                ))}
              </div>
              <div className="mt-10 flex flex-wrap gap-4">
                <a
                  href="#calculator"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
                >
                  Calcular mi precio
                </a>
                <a
                  href="#demo"
                  className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Solicitar una demo
                </a>
              </div>
            </div>

            <div className="grid gap-5 self-start">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Tramo de referencia
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{recommendedTier.name}</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">{recommendedTier.tagline}</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm text-slate-300">Precio</div>
                    <div className="mt-2 text-3xl font-semibold text-white">
                      {formatCurrency(recommendedTier.pricePerClassroomPerYear)}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">por aula / año</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm text-slate-300">Piloto</div>
                    <div className="mt-2 text-3xl font-semibold text-white">
                      {formatCurrency(PILOT.totalPrice)}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {PILOT.classrooms} aulas durante {PILOT.durationDays} días
                    </div>
                  </div>
                </div>
                <div className="mt-6 rounded-xl border border-sky-500/20 bg-sky-500/10 p-4">
                  <div className="text-sm font-medium text-sky-300">
                    Precio orientativo para decidir rápido; validación comercial si el alcance es
                    especial o multi-sede.
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-400">
                    Onboarding
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white">Separado</div>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    Desde {formatCurrency(ONBOARDING_TIERS[0].oneTimeFee ?? 0)} para mantener el
                    recurrente por aula lo más limpio posible.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-400">
                    Enfoque
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white">Esencial</div>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    Lo que necesitas para controlar el acceso por aula. Sin módulos que no vas a
                    usar.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <RevealSection id="next-step" className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Decisión rápida
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
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
                    className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium leading-7 text-slate-700 transition duration-300 hover:-translate-y-0.5 hover:shadow-md"
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
                <div className="flex items-center justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                      Campaña activa
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-slate-900">
                      Acceso gratuito para centros públicos
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
                  {PILOT.name}
                </div>
                <h3 className="mt-3 text-2xl font-semibold text-slate-900">
                  {PILOT.classrooms} aulas durante {PILOT.durationDays} días por{' '}
                  {formatCurrency(PILOT.totalPrice)}
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  {PILOT.tagline} Es la opción más útil cuando necesitas validar uso real antes de
                  pasar a contratación anual.
                </p>
                <a
                  href="#demo"
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
                  className={`rounded-[2rem] border p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg ${
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
                  <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Aproximado por dispositivo
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-900">
                      {formatPricePerDevice(tier.approxPricePerDevicePerYear)} / año
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-500">{tier.bestFor}</p>
                </div>
              ))}
            </div>

            <p className="mt-5 text-sm text-slate-500">
              Todos los tramos requieren un{' '}
              <a href="#onboarding" className="underline hover:text-slate-700">
                onboarding inicial
              </a>{' '}
              (coste único, ver más abajo). IVA no incluido.{' '}
              <a href="#calculator" className="font-medium text-sky-700 hover:text-sky-600">
                Ir a calculadora →
              </a>
            </p>

            <div id="onboarding" className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">
                  Onboarding (pago único)
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Se separa del recurrente para que el centro compare el coste anual por aula de
                  forma más limpia y entienda el esfuerzo inicial por separado.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {ONBOARDING_TIERS.map((tier) => (
                    <div key={tier.rangeLabel} className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm font-semibold text-slate-900">{tier.rangeLabel}</div>
                      <div className="mt-3 text-2xl font-semibold text-slate-950">
                        {tier.oneTimeFee === null ? tier.label : formatCurrency(tier.oneTimeFee)}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">pago único</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-slate-900 bg-slate-900 px-6 py-7 text-white shadow-lg">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Por qué ClassroomPath
                </div>
                <div className="mt-4 space-y-3">
                  {COMPETITIVE_CLAIMS.map((item) => (
                    <p
                      key={item}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-slate-200"
                    >
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </RevealSection>

        <section id="calculator" className="border-y border-slate-200 bg-slate-900 text-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
                <Calculator size={16} />
                Calculadora por aulas
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Estima el coste del primer año en 10 segundos
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                Aplica el tramo que corresponde al número de aulas, añade el onboarding y obtén una
                referencia clara del primer año antes de pedir una propuesta detallada.
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
                  Aula controlada: hasta 30 dispositivos bajo una política de acceso definida.
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

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
                  <div className="text-sm text-slate-400">Precio anual</div>
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
                <div className="rounded-xl border border-white/10 bg-slate-800/70 p-5">
                  <div className="text-sm text-slate-400">Precio aproximado por dispositivo</div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    {formatPricePerDevice(quote.approxPricePerDevicePerYear)}
                  </div>
                </div>
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
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
            <div className="rounded-[2rem] border border-slate-200 bg-slate-50 px-6 py-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Por qué cobramos por aula y no por dispositivo
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
                Referencias públicas (precios convertidos a € aprox.)
              </div>
              <h3 className="mt-4 text-2xl font-semibold text-slate-900">
                Frente a suites con más módulos, ClassroomPath ofrece lo esencial a un precio más
                bajo
              </h3>
              <div className="mt-6 space-y-4">
                {MARKET_BENCHMARKS.map((item) => (
                  <div key={item.vendor} className="rounded-xl bg-slate-50 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.vendor}</div>
                        <div className="text-sm text-slate-500">{item.reference}</div>
                      </div>
                      <div className="text-sm font-medium text-slate-700">
                        {item.visiblePublicRange}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm leading-7 text-slate-500">
                Comparativa orientativa basada en referencias públicas visibles y conversiones
                aproximadas a €. Puede variar por país, canal, volumen y condiciones contractuales.
              </p>
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
            <p className="mt-6 text-sm text-slate-500">
              Si necesitas alguna de estas funcionalidades, consúltanos.{' '}
              <a
                href="mailto:hola@classroompath.com"
                className="font-medium text-sky-700 hover:text-sky-600"
              >
                hola@classroompath.com
              </a>
            </p>
          </div>
        </RevealSection>

        <FaqAccordion
          items={PRICING_FAQS}
          sectionLabel="FAQ"
          sectionTitle="Respuestas directas para evaluación institucional"
        />

        <section id="demo" className="bg-slate-50 py-20">
          <div className="mx-auto max-w-5xl px-6 lg:px-8">
            <div className="rounded-[2.25rem] border border-sky-100 bg-white px-8 py-14 shadow-lg shadow-sky-100/60">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
                  <ShieldCheck size={32} className="text-sky-600" />
                </div>
                <div className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Solicitar demo
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                  Solicita una demo o empieza con un piloto de 5 aulas
                </h2>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
                  Revisamos el número de aulas, la política de acceso prevista y el siguiente paso
                  para tu centro o red de centros.
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
                {' · '}
                Precios orientativos para contratación anual. IVA no incluido. La comparación con
                otras soluciones se basa en referencias públicas visibles y puede variar según país,
                volumen, canal y condiciones contractuales.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SharedFooter />
    </div>
  );
}
