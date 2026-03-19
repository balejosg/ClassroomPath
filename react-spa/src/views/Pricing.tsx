import React from 'react';
import { ArrowRight, Calculator, ShieldCheck } from 'lucide-react';

interface ClassroomPathPricingPageProps {
  onNavigateToLogin: () => void;
}

type PricingTier = {
  name: string;
  rangeLabel: string;
  minClassrooms: number;
  maxClassrooms: number | null;
  pricePerClassroomPerYear: number;
  approxPricePerDevicePerYear: number;
  tagline: string;
};

type OnboardingTier = {
  rangeLabel: string;
  minClassrooms: number;
  maxClassrooms: number | null;
  oneTimeFee: number | null;
  label?: string;
};

const PILOT = {
  name: 'Piloto',
  classrooms: 5,
  durationDays: 90,
  totalPrice: 290,
  tagline: 'Valida el modelo en pocas aulas antes de escalar.',
};

const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Centro pequeño',
    rangeLabel: '1-10 aulas',
    minClassrooms: 1,
    maxClassrooms: 10,
    pricePerClassroomPerYear: 55,
    approxPricePerDevicePerYear: 1.83,
    tagline: 'Una forma simple de ordenar la política digital del centro.',
  },
  {
    name: 'Centro mediano',
    rangeLabel: '11-25 aulas',
    minClassrooms: 11,
    maxClassrooms: 25,
    pricePerClassroomPerYear: 45,
    approxPricePerDevicePerYear: 1.5,
    tagline: 'Escala con un coste por aula más competitivo.',
  },
  {
    name: 'Centro grande',
    rangeLabel: '26-50 aulas',
    minClassrooms: 26,
    maxClassrooms: 50,
    pricePerClassroomPerYear: 37,
    approxPricePerDevicePerYear: 1.23,
    tagline: 'Precio optimizado para despliegues de varias aulas.',
  },
  {
    name: 'Organización educativa',
    rangeLabel: '51-100 aulas',
    minClassrooms: 51,
    maxClassrooms: 100,
    pricePerClassroomPerYear: 32,
    approxPricePerDevicePerYear: 1.07,
    tagline: 'Pensado para operación estable a escala.',
  },
  {
    name: 'Red de centros',
    rangeLabel: '101+ aulas',
    minClassrooms: 101,
    maxClassrooms: null,
    pricePerClassroomPerYear: 27,
    approxPricePerDevicePerYear: 0.9,
    tagline: 'Precio optimizado para multi-sede o gran despliegue.',
  },
];

const ONBOARDING_TIERS: OnboardingTier[] = [
  {
    rangeLabel: 'Hasta 25 aulas',
    minClassrooms: 1,
    maxClassrooms: 25,
    oneTimeFee: 490,
  },
  {
    rangeLabel: '26-100 aulas',
    minClassrooms: 26,
    maxClassrooms: 100,
    oneTimeFee: 890,
  },
  {
    rangeLabel: '101+ aulas',
    minClassrooms: 101,
    maxClassrooms: null,
    oneTimeFee: null,
    label: 'Consultar',
  },
];

const INCLUDED_PER_CLASSROOM = [
  'Hasta 30 dispositivos por aula',
  'Políticas de acceso a Internet',
  'Cola de solicitudes de desbloqueo',
  'Administración básica',
  'Hosting y operación estándar',
  'Actualizaciones incluidas',
  'Soporte por email',
  'Servicio gestionado sobre OpenPath',
];

const NOT_INCLUDED_BASE_PLAN = [
  'SSO empresarial',
  'SLA premium',
  'Migración avanzada',
  'Formación onsite',
  'Soporte prioritario',
  'Políticas muy personalizadas por sede o etapa',
];

const VALUE_BULLETS = [
  'Internet intencional para centros educativos',
  'Menos ruido digital',
  'Política digital clara y defendible',
  'Servicio gestionado sobre OpenPath',
  'Operación simple para el equipo TIC',
  'Infraestructura más calmada y enfocada',
];

const PER_CLASSROOM_POINTS = [
  'El centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  'El modelo por aula es más fácil de explicar, presupuestar y escalar.',
  'Permite alinear mejor el precio con la realidad operativa del centro.',
];

const COMPETITIVE_CLAIMS = [
  'Precio por aula diseñado para quedar por debajo de las referencias públicas visibles de suites comparables.',
  'Una de las formas más asequibles de implantar acceso a Internet intencional en el centro.',
  'Servicio gestionado con un coste por aula especialmente competitivo.',
];

const MARKET_BENCHMARKS = [
  {
    vendor: 'Lightspeed',
    reference: 'Filter + Classroom',
    visiblePublicRange: '£4.50-£5.50 / dispositivo / año aprox.',
  },
  {
    vendor: 'Securly',
    reference: 'Filter',
    visiblePublicRange: '~$5.98 / dispositivo / año',
  },
  {
    vendor: 'GoGuardian',
    reference: 'Admin + Teacher Bundle',
    visiblePublicRange: '~$10 / dispositivo / año',
  },
  {
    vendor: 'Linewize',
    reference: 'Filter + Classwize',
    visiblePublicRange: '~$7+ / dispositivo / año según tier o listing',
  },
];

const FAQS = [
  {
    question: '¿Qué cuenta como un aula?',
    answer:
      'Un conjunto de hasta 30 dispositivos institucionales bajo una política de acceso definida.',
  },
  {
    question: '¿Puedo empezar con un piloto?',
    answer: 'Sí, hay un piloto de 5 aulas durante 90 días.',
  },
  {
    question: '¿El onboarding está incluido?',
    answer: 'No. Se cobra aparte para mantener el recurrente por aula lo más bajo posible.',
  },
  {
    question: '¿Por qué cobráis por aula y no por dispositivo?',
    answer:
      'Porque el centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  },
  {
    question: '¿Qué pasa si un aula tiene más de 30 dispositivos?',
    answer: 'Se recomienda contarla como 2 aulas o pasar a un tramo personalizado.',
  },
  {
    question: '¿Incluye soporte?',
    answer: 'Sí, soporte estándar por email. SLA premium aparte.',
  },
  {
    question: '¿Es software open source?',
    answer: 'OpenPath es la base open source; ClassroomPath añade la capa gestionada y operativa.',
  },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPricePerDevice(value: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: value < 1 ? 2 : 1,
    maximumFractionDigits: 2,
  }).format(value);
}

function getPricingTier(classrooms: number) {
  return (
    PRICING_TIERS.find(
      (tier) =>
        classrooms >= tier.minClassrooms &&
        (tier.maxClassrooms === null || classrooms <= tier.maxClassrooms)
    ) ?? PRICING_TIERS[0]
  );
}

function getOnboardingTier(classrooms: number) {
  return (
    ONBOARDING_TIERS.find(
      (tier) =>
        classrooms >= tier.minClassrooms &&
        (tier.maxClassrooms === null || classrooms <= tier.maxClassrooms)
    ) ?? ONBOARDING_TIERS[0]
  );
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
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

export function ClassroomPathPricingPage({ onNavigateToLogin }: ClassroomPathPricingPageProps) {
  const [classroomsInput, setClassroomsInput] = React.useState('12');
  const classroomsInputId = React.useId();
  const parsedClassrooms = parsePositiveInteger(classroomsInput);
  const quote = getPricingQuote(parsedClassrooms ?? 12);

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      <section className="relative overflow-hidden border-b border-white/10 bg-slate-950">
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
        <div className="relative mx-auto max-w-7xl px-6 py-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-400/30">
                <ShieldCheck size={24} />
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white">
                  ClassroomPath
                </div>
                <div className="text-sm text-slate-300">Servicio gestionado sobre OpenPath</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                Acceder
              </button>
              <a
                href="#calculator"
                className="rounded-full border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-400/15"
              >
                Calcular mi precio
              </a>
              <a
                href="#demo"
                className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              >
                Solicitar demo
              </a>
            </div>
          </div>
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pb-28 lg:pt-16">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-100">
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
              Servicio gestionado para aplicar políticas de acceso por defecto cerrado en aulas y
              dispositivos institucionales. Menos vigilancia y más gobernanza.
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
                className="rounded-full bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              >
                Solicitar demo
              </a>
              <a
                href="#pilot"
                className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Empezar un piloto
              </a>
            </div>
          </div>

          <div className="grid gap-5 self-start">
            <div className="rounded-[2rem] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-100">
                Unidad comercial
              </div>
              <div className="mt-3 text-3xl font-semibold text-white">Aula controlada</div>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Hasta 30 dispositivos gestionados bajo una política de acceso definida.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="text-sm text-slate-300">Desde</div>
                  <div className="mt-2 text-3xl font-semibold text-white">27 €</div>
                  <div className="mt-1 text-sm text-slate-400">por aula / año</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  <div className="text-sm text-slate-300">Piloto</div>
                  <div className="mt-2 text-3xl font-semibold text-white">290 €</div>
                  <div className="mt-1 text-sm text-slate-400">5 aulas durante 90 días</div>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4">
                <div className="text-sm font-medium text-sky-100">
                  Política digital defendible, sin convertir la operación en un proyecto extra.
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Facturación
                </div>
                <div className="mt-3 text-2xl font-semibold text-slate-900">Anual</div>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Contratación mínima de 1 año. IVA no incluido.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Enfoque
                </div>
                <div className="mt-3 text-2xl font-semibold text-slate-900">Calmado</div>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Menos ruido digital, más aprendizaje con criterio.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Qué incluye cada aula
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Un servicio gestionado para ordenar el acceso a Internet sin cargar más al equipo TIC
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {INCLUDED_PER_CLASSROOM.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm font-medium leading-7 text-slate-700 transition duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5">
            <div
              id="pilot"
              className="rounded-[2rem] border border-sky-200 bg-sky-50 px-6 py-7 shadow-sm"
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
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Empezar un piloto <ArrowRight size={16} />
              </a>
            </div>

            <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                No incluido en el plan base
              </div>
              <div className="mt-5 space-y-3">
                {NOT_INCLUDED_BASE_PLAN.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-stone-50">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Tramos de precio
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Un modelo simple para presupuestar por aula y escalar con criterio
            </h2>
            <p className="mt-5 text-base leading-8 text-slate-600">
              ClassroomPath cobra por aula controlada, no por licencias sueltas. Así el centro puede
              entender el coste con rapidez y decidir a qué ritmo quiere implantar la política
              digital.
            </p>
          </div>

          <div className="mt-12 grid gap-5 xl:grid-cols-5">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-[2rem] border p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg ${
                  tier.name === 'Centro mediano'
                    ? 'border-sky-300 bg-white ring-1 ring-inset ring-sky-200'
                    : 'border-stone-200 bg-white/90'
                }`}
              >
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  {tier.rangeLabel}
                </div>
                <h3 className="mt-4 text-2xl font-semibold text-slate-900">{tier.name}</h3>
                <div className="mt-6 text-4xl font-semibold tracking-tight text-slate-950">
                  {formatCurrency(tier.pricePerClassroomPerYear)}
                </div>
                <div className="mt-2 text-sm text-slate-500">por aula / año</div>
                <p className="mt-5 text-sm leading-7 text-slate-600">{tier.tagline}</p>
                <div className="mt-6 rounded-2xl bg-stone-50 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Aproximación por dispositivo
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-900">
                    {formatPricePerDevice(tier.approxPricePerDevicePerYear)} / año
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-7 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Onboarding
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {ONBOARDING_TIERS.map((tier) => (
                  <div key={tier.rangeLabel} className="rounded-2xl bg-stone-50 px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">{tier.rangeLabel}</div>
                    <div className="mt-3 text-2xl font-semibold text-slate-950">
                      {tier.oneTimeFee === null ? tier.label : formatCurrency(tier.oneTimeFee)}
                    </div>
                    <div className="mt-2 text-sm text-slate-500">pago único</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-900 bg-slate-950 px-6 py-7 text-white shadow-lg">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-100">
                Lectura comercial
              </div>
              <div className="mt-4 space-y-3">
                {COMPETITIVE_CLAIMS.map((item) => (
                  <p
                    key={item}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-slate-200"
                  >
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="calculator" className="border-y border-slate-900/10 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-100">
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
                className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-900 px-5 py-4 text-3xl font-semibold text-white outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-300/30"
              />
              <p className="mt-3 text-sm leading-7 text-slate-400">
                Aula controlada: hasta 30 dispositivos bajo una política de acceso definida.
              </p>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-100">
                  Tramo aplicado
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{quote.tier.name}</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">{quote.tier.tagline}</p>
              </div>
              <div className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
                {quote.classrooms} aulas x {formatCurrency(quote.tier.pricePerClassroomPerYear)}
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                <div className="text-sm text-slate-400">Precio anual</div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {formatCurrency(quote.annualTotal)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                <div className="text-sm text-slate-400">Onboarding</div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {quote.onboardingFee === null
                    ? quote.onboardingTier.label
                    : formatCurrency(quote.onboardingFee)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                <div className="text-sm text-slate-400">Total primer año</div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {quote.totalFirstYear === null
                    ? quote.onboardingTier.label
                    : formatCurrency(quote.totalFirstYear)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
                <div className="text-sm text-slate-400">Precio aproximado por dispositivo</div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {formatPricePerDevice(quote.approxPricePerDevicePerYear)}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-7 text-slate-300">
              {quote.onboardingFee === null
                ? 'En despliegues de 101 aulas o más, el onboarding se define con una propuesta específica por sede, alcance y ritmo de implantación.'
                : `El onboarding para ${quote.classrooms} aulas queda en el tramo ${quote.onboardingTier.rangeLabel.toLowerCase()}.`}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div className="rounded-[2rem] border border-stone-200 bg-stone-50 px-6 py-7 shadow-sm">
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
                  className="rounded-2xl border border-white/70 bg-white px-5 py-4 text-sm leading-7 text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-7 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Referencias públicas visibles
            </div>
            <h3 className="mt-4 text-2xl font-semibold text-slate-900">
              Frente a suites más amplias, ClassroomPath busca una propuesta más sobria y más
              asequible
            </h3>
            <div className="mt-6 space-y-4">
              {MARKET_BENCHMARKS.map((item) => (
                <div key={item.vendor} className="rounded-2xl bg-stone-50 px-5 py-4">
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
              Comparativa orientativa basada en referencias públicas visibles. Puede variar por
              país, canal, volumen y condiciones contractuales.
            </p>
          </div>
        </div>
      </section>

      <section id="faq" className="border-y border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              FAQ
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Respuestas directas para evaluación institucional
            </h2>
          </div>
          <div className="mt-10 space-y-4">
            {FAQS.map((item) => (
              <details
                key={item.question}
                className="group rounded-[1.5rem] border border-stone-200 bg-white px-6 py-5 shadow-sm"
              >
                <summary className="cursor-pointer list-none text-lg font-semibold text-slate-900">
                  {item.question}
                </summary>
                <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="demo" className="bg-white">
        <div className="mx-auto max-w-5xl px-6 py-20 lg:px-8">
          <div className="rounded-[2.25rem] border border-sky-100 bg-[linear-gradient(135deg,#f8fcff_0%,#eef7fb_100%)] px-8 py-14 text-center shadow-lg shadow-sky-100/60">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <ShieldCheck size={32} />
            </div>
            <div className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Siguiente paso
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Solicita una demo o plantea un piloto con unas pocas aulas
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
              Revisamos el número de aulas, la política de acceso prevista y el encaje operativo
              para tu centro o red de centros.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <a
                href="mailto:hola@classroompath.com?subject=Solicitar%20demo%20ClassroomPath"
                className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Solicitar demo
              </a>
              <a
                href="mailto:hola@classroompath.com?subject=Piloto%20ClassroomPath"
                className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Empezar un piloto
              </a>
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-6 py-3 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
              >
                Acceder al panel <ArrowRight size={16} />
              </button>
            </div>
            <p className="mt-8 text-xs leading-6 text-slate-500">
              Precios orientativos para contratación anual. IVA no incluido. La comparación con
              otras soluciones se basa en referencias públicas visibles y puede variar según país,
              volumen, canal y condiciones contractuales.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
