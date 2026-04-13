import {
  Building2,
  Layers,
  Rocket,
  School,
  ShieldCheck,
  Target,
  Unlock,
  Users,
} from 'lucide-react';

import { ContactForm } from '../components/ContactForm';
import { FaqAccordion } from '../components/FaqAccordion';
import { RevealSection } from '../components/RevealSection';
import { SharedFooter } from '../components/SharedFooter';
import { LANDING_FAQS } from '../data/faqs';

interface ClassroomPathLandingPageProps {
  onNavigateToLogin: () => void;
}

const quickBenefits = [
  {
    title: 'Precio por aula, no por licencias sueltas',
    text: 'El centro presupuesta y escala con una unidad que entiende: el aula.',
  },
  {
    title: 'Activación remota con el IT del centro',
    text: 'Acompañamos al responsable técnico para dejar el arranque encarrilado sin convertirlo en otro proyecto paralelo.',
  },
  {
    title: 'Software abierto, servicio gestionado',
    text: 'Operas con soporte y acompañamiento, sin renunciar a auditar el código ni a migrar si algún día lo necesitas.',
  },
];

const practicalSteps = [
  {
    step: 'Paso 1',
    title: 'El centro define el criterio',
    text: 'Se traduce la política digital del centro a reglas claras por aula, etapa o necesidad docente.',
  },
  {
    step: 'Paso 2',
    title: 'La activación inicial se prepara con el IT del centro',
    text: 'ClassroomPath acompaña en remoto al responsable técnico para validar red, dispositivos y el arranque de las primeras aulas.',
  },
  {
    step: 'Paso 3',
    title: 'El acceso se gestiona con menos fricción',
    text: 'El profesorado trabaja con recursos útiles, el equipo TIC mantiene control por aula y la política deja de vivir solo en un documento.',
  },
];

const roleBenefits = [
  {
    icon: <Building2 size={20} className="text-sky-600" />,
    title: 'Dirección',
    text: 'Una política digital explicable, coherente con el proyecto educativo y aplicable de verdad.',
  },
  {
    icon: <Users size={20} className="text-sky-600" />,
    title: 'Profesorado',
    text: 'Menos ruido en clase y un flujo claro para solicitar aperturas cuando un recurso sí tiene sentido pedagógico.',
  },
  {
    icon: <School size={20} className="text-sky-600" />,
    title: 'Equipo TIC',
    text: 'Control de acceso por aula sin montar otra infraestructura ni convertir el mantenimiento en otra carga diaria.',
  },
];

const fitSignals = [
  {
    icon: <Target size={20} className="text-sky-600" />,
    title: 'Filtrado web escolar por aula',
    text: 'Decidir qué recursos se permiten y cuáles no según etapa, aula o uso docente.',
  },
  {
    icon: <Layers size={20} className="text-sky-600" />,
    title: 'Control para dispositivos del centro',
    text: 'Aplicar una política clara en portátiles, carros, aulas compartidas, laboratorios o FP.',
  },
  {
    icon: <Rocket size={20} className="text-sky-600" />,
    title: 'Despliegue con tu equipo IT',
    text: 'Arrancar con apoyo remoto acotado sin depender de una implantación pesada por parte del proveedor.',
  },
  {
    icon: <Unlock size={20} className="text-sky-600" />,
    title: 'Transparencia y autonomía',
    text: 'Operar sobre código abierto y conservar una salida real si el centro quiere migrar a OpenPath.',
  },
];

export function ClassroomPathLandingPage({ onNavigateToLogin }: ClassroomPathLandingPageProps) {
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
                <div className="text-xs text-slate-400">Filtrado web escolar por aula</div>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-5">
              <a
                href="/pricing"
                className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
              >
                Precios
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
                href="/pricing"
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
              >
                Calcular precio
              </a>
              <a
                href="#solicitud"
                className="hidden rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 md:inline-flex"
              >
                Solicitar activación
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
          <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-28">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-300">
                Filtrado web escolar por aula · servicio gestionado sobre OpenPath
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Decide qué Internet entra en cada aula, sin cargar más al equipo TIC.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                ClassroomPath convierte la política digital del centro en reglas operativas reales:
                qué se abre, qué se bloquea y cómo se gestiona, aula por aula. Con precio público,
                activación remota ligera y sin dependencia de proveedor.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="/pricing"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
                >
                  Calcular precio
                </a>
                <a
                  href="#solicitud"
                  className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Solicitar activación
                </a>
              </div>
              <p className="mt-6 text-sm text-slate-300">
                Hasta 30 dispositivos por aula · apoyo remoto al IT del centro · código abierto
                auditable
              </p>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                Servicio gestionado sobre OpenPath
              </div>
              <div className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
                <p>
                  ClassroomPath no vende una suite docente generalista. Ordena el acceso web por
                  aula para que el centro pueda aplicar una política digital clara.
                </p>
                <p>
                  El foco está en decidir qué se abre, qué se bloquea y cómo se sostiene esa
                  decisión sin más carga diaria para el equipo TIC.
                </p>
                <p>
                  Si necesitas presupuesto, vas a precio por aula. Si quieres empezar con poco
                  alcance, solicitas una activación remota.
                </p>
              </div>
            </div>
          </div>
        </section>

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

        <RevealSection className="bg-slate-900 text-white">
          <div className="mx-auto max-w-5xl px-6 py-16 text-center lg:px-8">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              No vendemos más tiempo de pantalla.
            </h2>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-slate-300">
              Ayudamos a que Internet esté disponible cuando aporta valor pedagógico, bajo un
              criterio claro y sostenible para el centro.
            </p>
          </div>
        </RevealSection>

        <RevealSection className="bg-slate-50">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Operación
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Cómo funciona en la práctica
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                La mejora no está solo en bloquear. Está en convertir la política digital del centro
                en una operación clara: qué se permite, quién lo decide y cómo se sostiene sin
                improvisación continua.
              </p>
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

        <RevealSection className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
            <div className="max-w-3xl">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Perfiles
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Qué gana cada perfil
              </h2>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-3">
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
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Encaje
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                ClassroomPath encaja si tu centro necesita...
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                Está pensado para centros que ya han decidido que necesitan una política de acceso
                clara y una operación más sencilla.
              </p>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {fitSignals.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
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
          <div className="relative mx-auto max-w-5xl px-6 py-16 lg:px-8">
            <div className="rounded-[2rem] border border-emerald-200 bg-white/80 px-8 py-10 shadow-sm">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                Campaña activa · plazas limitadas
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Acceso inicial para centros públicos
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-700">
                Si tu centro es de titularidad pública, puedes acceder a ClassroomPath sin coste
                para hasta 5 aulas mientras haya disponibilidad.
              </p>
              <div className="mt-6 space-y-2 text-sm text-slate-700">
                <p>
                  Incluye sesión remota con el IT del centro, checklist de arranque y soporte
                  estándar por email.
                </p>
                <p>Sin compromiso posterior.</p>
                <p>Plazas sujetas a disponibilidad y verificación de titularidad pública.</p>
              </div>
              <a
                href="mailto:hola@classroompath.com?subject=Consulta%20disponibilidad%20centro%20p%C3%BAblico"
                className="mt-8 inline-flex rounded-lg bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Consultar disponibilidad
              </a>
            </div>
          </div>
        </RevealSection>

        <FaqAccordion
          items={LANDING_FAQS}
          sectionLabel="Preguntas frecuentes"
          sectionTitle="Lo que suelen preguntar los centros"
        />

        <section id="solicitud" className="bg-slate-50 pb-24 pt-20">
          <div className="mx-auto max-w-5xl px-6 lg:px-8">
            <div className="rounded-2xl border border-sky-100 bg-white px-8 py-16 shadow-lg">
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
                  <ShieldCheck size={32} className="text-sky-600" />
                </div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Solicitar presupuesto, activación o demo
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                  Coordina el siguiente paso con tu equipo IT
                </h2>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
                  Cuéntanos cuántas aulas quieres controlar, quién lidera la parte técnica y si
                  necesitas presupuesto, activación o demo. Respondemos en 48 h.
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
