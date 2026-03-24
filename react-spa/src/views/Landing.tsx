import {
  ShieldCheck,
  Lock,
  BookOpen,
  Building2,
  Code2,
  Unlock,
  School,
  Target,
  Layers,
  Rocket,
  Users,
} from 'lucide-react';

import { SharedFooter } from '../components/SharedFooter';
import { FaqAccordion } from '../components/FaqAccordion';
import { ContactForm } from '../components/ContactForm';
import { RevealSection } from '../components/RevealSection';
import { LANDING_FAQS } from '../data/faqs';

interface ClassroomPathLandingPageProps {
  onNavigateToLogin: () => void;
}

const trustSignals = [
  {
    title: 'Hasta 30 dispositivos institucionales por aula',
    text: 'Una unidad clara para presupuestar, implantar y escalar sin licencias dispersas.',
  },
  {
    title: 'Onboarding guiado en la primera semana',
    text: 'Sesión inicial, acompañamiento y arranque sin convertir el despliegue en un proyecto paralelo.',
  },
  {
    title: 'Código abierto y sin vendor lock-in',
    text: 'ClassroomPath opera sobre OpenPath para que el centro mantenga una salida viable y auditable.',
  },
];

const fitSignals = [
  {
    icon: <Target size={20} className="text-sky-600" />,
    title: 'Filtrado web escolar por aula',
    text: 'Necesitas decidir qué recursos se abren y cuáles no, según etapa, aula o uso docente.',
  },
  {
    icon: <Layers size={20} className="text-sky-600" />,
    title: 'Control para dispositivos institucionales',
    text: 'El centro quiere una política digital defendible para portátiles, carros o aulas compartidas.',
  },
  {
    icon: <Rocket size={20} className="text-sky-600" />,
    title: 'Despliegue sin infraestructura propia',
    text: 'Quieres una operación gestionada para no cargar más trabajo diario al equipo TIC.',
  },
  {
    icon: <Unlock size={20} className="text-sky-600" />,
    title: 'Transparencia y salida futura',
    text: 'Buscas software auditable y sin dependencia obligatoria de un proveedor cerrado.',
  },
];

const roleBenefits = [
  {
    icon: <Building2 size={20} className="text-sky-600" />,
    title: 'Dirección',
    text: 'Puede defender una política digital clara, coherente con el proyecto educativo y fácil de explicar.',
  },
  {
    icon: <Users size={20} className="text-sky-600" />,
    title: 'Profesorado',
    text: 'Abre recursos útiles sin pelear cada clase con distracciones o navegación improductiva.',
  },
  {
    icon: <School size={20} className="text-sky-600" />,
    title: 'Equipo TIC',
    text: 'Mantiene control de acceso por aula con menos tickets manuales y una operación más previsible.',
  },
];

const operatingPrinciples = [
  {
    icon: <Lock size={16} className="shrink-0 text-sky-600" />,
    text: 'Acceso por defecto controlado y aperturas con criterio pedagógico.',
  },
  {
    icon: <BookOpen size={16} className="shrink-0 text-sky-600" />,
    text: 'Políticas alineadas con etapa, asignatura o contexto de aula.',
  },
  {
    icon: <Code2 size={16} className="shrink-0 text-sky-600" />,
    text: 'OpenPath + ClassroomPath auditables de principio a fin.',
  },
];

const milestones = [
  {
    step: 'Semana 1',
    title: 'Definimos qué acceso tiene sentido',
    text: 'Aterrizamos la política digital del centro en reglas concretas por aula, etapa o necesidad operativa.',
  },
  {
    step: 'Semana 2',
    title: 'Arranca el servicio con onboarding guiado',
    text: 'Ponemos en marcha el entorno y resolvemos el primer despliegue sin dejar al centro solo con la configuración.',
  },
  {
    step: 'Semana 3+',
    title: 'El centro opera con menos fricción',
    text: 'La política se vuelve estable, medible y más fácil de sostener sin supervisión constante.',
  },
];

export function ClassroomPathLandingPage({ onNavigateToLogin }: ClassroomPathLandingPageProps) {
  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-5 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 shadow-lg shadow-sky-900/50">
                <ShieldCheck size={22} className="text-white" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white">
                  ClassroomPath
                </div>
                <div className="text-xs text-slate-400">Transparencia basada en Software Libre</div>
              </div>
            </div>
            <div className="flex items-center gap-5">
              <a
                href="/pricing"
                className="text-sm font-medium text-slate-300 transition hover:text-white"
              >
                Precios
              </a>
              <a
                href="/login"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigateToLogin();
                }}
                className="text-sm font-medium text-slate-400 transition hover:text-white"
              >
                Acceder
              </a>
              <a
                href="#demo"
                data-testid="navigate-to-register"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
              >
                Solicitar demo
              </a>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-slate-900">
          <div
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
              backgroundSize: '30px 30px',
            }}
          />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-28">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-300">
                Filtrado web escolar para dispositivos institucionales
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Controla Internet por aula sin sobrecargar TIC.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
                ClassroomPath ayuda a los centros a definir una política digital clara y llevarla a
                dispositivos institucionales con control de acceso por aula, despliegue guiado y
                operación gestionada.
              </p>
              <p className="mt-4 max-w-xl text-base leading-7 text-slate-400">
                Empieza por precio si necesitas presupuesto. Empieza por piloto si antes quieres
                validar el encaje en pocas aulas. En ambos casos, el centro mantiene transparencia,
                trazabilidad y una salida viable sobre OpenPath.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="/pricing"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
                >
                  Calcular precio por aulas
                </a>
                <a
                  href="#demo"
                  className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Solicitar piloto guiado
                </a>
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {trustSignals.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-200"
                  >
                    <div className="font-semibold text-white">{item.title}</div>
                    <div className="mt-2 leading-6 text-slate-300">{item.text}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:pl-8">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Qué cambia con ClassroomPath
                </div>
                <div className="mt-5 space-y-4">
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-4">
                    <div className="text-sm font-medium text-sky-300">Dirección</div>
                    <div className="mt-2 text-sm leading-7 text-slate-300">
                      Pasa de una norma abstracta a una política digital que se puede defender y
                      aplicar.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm font-medium text-white">Profesorado</div>
                    <div className="mt-2 text-sm leading-7 text-slate-400">
                      Trabaja con recursos útiles y menos ruido durante la clase.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm font-medium text-white">Equipo TIC</div>
                    <div className="mt-2 text-sm leading-7 text-slate-400">
                      Gana control por aula sin convertir el mantenimiento en otra carga diaria.
                    </div>
                  </div>
                </div>
                <div className="mt-6 rounded-xl border border-white/10 bg-slate-800/80 p-4">
                  <div className="text-sm font-medium text-white">Ruta recomendada</div>
                  <ol className="mt-3 space-y-2 text-sm leading-7 text-slate-400">
                    <li>1. Calcula el precio orientativo por número de aulas.</li>
                    <li>2. Valora un piloto si necesitas evidencias internas.</li>
                    <li>3. Agenda una demo para revisar encaje y despliegue.</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </section>

        <RevealSection className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
            <div className="grid gap-6 md:grid-cols-3">
              {roleBenefits.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                    {item.icon}
                  </div>
                  <div className="text-lg font-semibold text-slate-900">{item.title}</div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </RevealSection>

        <RevealSection className="bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
                Señales de encaje
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Encaja mejor si tu centro necesita
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                ClassroomPath no intenta vender más tiempo de pantalla. Encaja cuando el centro ya
                ha decidido que necesita una política de acceso más clara y una operación más
                sobria.
              </p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {fitSignals.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                    {item.icon}
                  </div>
                  <div className="text-lg font-semibold text-slate-900">{item.title}</div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </RevealSection>

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
          <div className="relative mx-auto max-w-7xl px-6 py-14 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                Campaña activa · Plazas limitadas
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Acceso gratuito para centros públicos.
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-700">
                Si tu centro es de titularidad pública, puedes acceder a ClassroomPath sin coste
                para <strong>hasta 5 aulas</strong> mientras dure la campaña. Incluye sesión de
                arranque, guía de implantación y soporte estándar por email. Sin compromiso
                posterior.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Plazas sujetas a disponibilidad. Verificación de titularidad pública al contactar.
              </p>
              <a
                href="mailto:hola@classroompath.com?subject=Disponibilidad%20campa%C3%B1a%20centro%20p%C3%BAblico"
                className="mt-7 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-800"
              >
                Consultar disponibilidad de la promoción
              </a>
            </div>
          </div>
        </RevealSection>

        <RevealSection className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr]">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
                  Qué cambia durante la implantación
                </div>
                <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                  Qué cambia durante las primeras semanas
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600">
                  La mejora no está solo en bloquear. Está en convertir una intención institucional
                  en una operación clara: quién decide, qué se permite y cómo se sostiene sin
                  improvisación continua.
                </p>
                <div className="mt-10 grid gap-5">
                  {milestones.map((item) => (
                    <div
                      key={item.step}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
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

              <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-8 shadow-sm">
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
                  Principios de operación
                </div>
                <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
                  Menos ruido digital, más criterio operativo
                </h3>
                <div className="mt-8 space-y-4">
                  {operatingPrinciples.map((item) => (
                    <div
                      key={item.text}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium leading-7 text-slate-700"
                    >
                      {item.icon}
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
                <blockquote className="mt-8 rounded-xl border border-sky-100 bg-white px-6 py-5 shadow-sm">
                  <p className="text-xl font-semibold leading-9 text-slate-900">
                    "No añadimos otra capa de ruido. Hacemos que el acceso a Internet vuelva a ser
                    una decisión del centro."
                  </p>
                  <p className="mt-3 text-sm text-slate-500">
                    ClassroomPath para centros con una política digital que quieren hacer operativa.
                  </p>
                </blockquote>
              </div>
            </div>
          </div>
        </RevealSection>

        <FaqAccordion
          items={LANDING_FAQS}
          sectionLabel="Preguntas frecuentes"
          sectionTitle="Lo que suelen preguntar los centros."
        />

        <section id="demo" className="bg-slate-50 pb-24 pt-20">
          <div className="mx-auto max-w-5xl px-6 lg:px-8">
            <div className="rounded-2xl border border-sky-100 bg-white px-8 py-16 shadow-lg">
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
                  <ShieldCheck size={32} className="text-sky-600" />
                </div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
                  Solicitar demo o piloto
                </div>
                <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                  Revisa si encaja en tu centro antes de desplegar
                </h2>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
                  Cuéntanos el número de aulas, el tipo de dispositivos institucionales y si buscas
                  un presupuesto orientativo, una demo o un piloto con pocas aulas.
                </p>
              </div>
              <div className="mx-auto mt-10 max-w-2xl">
                <ContactForm />
              </div>
              <p className="mt-8 text-center text-xs text-slate-400">
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
