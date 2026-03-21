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

// Re-export for tests that import from this module
export { getPricingQuote } from '../data/pricing-data';

interface ClassroomPathPricingPageProps {
  onNavigateToLogin: () => void;
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return parsed;
}

export function ClassroomPathPricingPage({ onNavigateToLogin }: ClassroomPathPricingPageProps) {
  const [classroomsInput, setClassroomsInput] = React.useState('12');
  const classroomsInputId = React.useId();
  const parsedClassrooms = parsePositiveInteger(classroomsInput);
  const quote = getPricingQuote(parsedClassrooms ?? 12);

  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      {/* ── Sticky nav (simplified: 2 actions) ── */}
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
                  <div className="text-xs text-slate-400">Servicio gestionado sobre OpenPath</div>
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
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="hidden text-sm text-slate-400 transition hover:text-white sm:inline"
              >
                Acceder
              </button>
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
        {/* ── Hero ── */}
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

          <div className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pb-28 lg:pt-16">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">
                Cuando haya pantalla, que haya propósito
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Precios simples por aula, para una política digital más clara
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                ClassroomPath ayuda a los centros a gestionar Internet con criterio en dispositivos
                institucionales, sin añadir complejidad al equipo TIC.
              </p>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
                Decide qué Internet tiene sentido en cada aula. El centro fija la política; nosotros
                la desplegamos y la mantenemos operativa. Código abierto, sin ataduras.
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
                  href="#demo"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
                >
                  Solicitar demo
                </a>
                <a
                  href="#pilot"
                  className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Empezar un piloto
                </a>
              </div>
            </div>

            <div className="grid gap-5 self-start">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Unidad comercial
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">Aula controlada</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Hasta 30 dispositivos gestionados bajo una política de acceso definida.
                </p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm text-slate-300">Desde</div>
                    <div className="mt-2 text-3xl font-semibold text-white">27 €</div>
                    <div className="mt-1 text-sm text-slate-400">por aula / año</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm text-slate-300">Piloto</div>
                    <div className="mt-2 text-3xl font-semibold text-white">290 €</div>
                    <div className="mt-1 text-sm text-slate-400">5 aulas durante 90 días</div>
                  </div>
                </div>
                <div className="mt-6 rounded-xl border border-sky-500/20 bg-sky-500/10 p-4">
                  <div className="text-sm font-medium text-sky-300">
                    Política digital defendible, sin convertir la operación en un proyecto extra.
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-400">
                    Facturación
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white">Anual</div>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    Contratación mínima de 1 año. IVA no incluido.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-400">
                    Enfoque
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-white">Calmado</div>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    Menos ruido digital, más aprendizaje con criterio.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Qué incluye cada aula ── */}
        <RevealSection className="border-b border-slate-200 bg-white">
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
                    className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium leading-7 text-slate-700 transition duration-300 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 self-start">
              {/* Compact public campaign banner (full version lives on Landing) */}
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
                <p className="mt-3 text-sm leading-7 text-slate-700">{PILOT.tagline}</p>
                <a
                  href="#demo"
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Empezar un piloto <ArrowRight size={16} />
                </a>
              </div>
            </div>
          </div>
        </RevealSection>

        {/* ── Tramos de precio ── */}
        <RevealSection id="pricing" className="bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Tramos de precio
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Un modelo simple para presupuestar por aula y escalar con criterio
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                ClassroomPath cobra por aula controlada, no por licencias sueltas. Así el centro
                puede entender el coste con rapidez y decidir a qué ritmo quiere implantar la
                política digital.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              {PRICING_TIERS.map((tier) => (
                <div
                  key={tier.name}
                  className={`rounded-[2rem] border p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg ${
                    tier.name === 'Centro mediano'
                      ? 'border-sky-300 bg-white ring-1 ring-inset ring-sky-200'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                    {tier.rangeLabel}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-900">{tier.name}</h3>
                  <div className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
                    {formatCurrency(tier.pricePerClassroomPerYear)}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">por aula / año</div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{tier.tagline}</p>
                  <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Aprox. por dispositivo
                    </div>
                    <div className="mt-2 text-base font-semibold text-slate-900">
                      {formatPricePerDevice(tier.approxPricePerDevicePerYear)} / año
                    </div>
                  </div>
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
                Calcular mi precio estimado →
              </a>
            </p>

            <div id="onboarding" className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[2rem] border border-slate-200 bg-white px-6 py-7 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">
                  Onboarding (pago único)
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Se separa del recurrente para mantener el precio por aula lo más bajo posible.
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

        {/* ── Calculadora ── */}
        <section id="calculator" className="border-y border-slate-200 bg-slate-900 text-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
                <Calculator size={16} />
                Calculadora por aulas
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Una estimación rápida para equipos directivos y responsables TIC
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                Aplica el tramo que corresponde al número de aulas, añade el onboarding y obtén una
                referencia clara del primer año.
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
              <div className="flex flex-wrap items-start justify-between gap-4">
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

        {/* ── Por qué aula + benchmarks ── */}
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
                Frente a suites más amplias, ClassroomPath busca una propuesta más sobria y más
                asequible
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

        {/* ── Transparencia: No incluido ── */}
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

        {/* ── FAQ ── */}
        <FaqAccordion
          items={PRICING_FAQS}
          sectionLabel="FAQ"
          sectionTitle="Respuestas directas para evaluación institucional"
        />

        {/* ── CTA final with contact form ── */}
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
                  Solicita una demo o plantea un piloto con unas pocas aulas
                </h2>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
                  Revisamos el número de aulas, la política de acceso prevista y el encaje operativo
                  para tu centro o red de centros.
                </p>
              </div>
              <div className="mx-auto mt-10 max-w-2xl">
                <ContactForm />
              </div>
              <p className="mt-8 text-center text-xs leading-6 text-slate-400">
                ¿Ya tienes cuenta?{' '}
                <button
                  type="button"
                  onClick={onNavigateToLogin}
                  className="underline transition hover:text-slate-600"
                >
                  Acceder al panel
                </button>
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
