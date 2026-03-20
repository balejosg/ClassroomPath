import React from 'react';
import {
  ShieldCheck,
  ArrowRight,
  Lock,
  BookOpen,
  Building2,
  Code2,
  Unlock,
  Mail,
  School,
  ChevronDown,
  Target,
  Layers,
  Globe,
} from 'lucide-react';

interface ClassroomPathLandingPageProps {
  onNavigateToLogin: () => void;
}

// ── Shared footer ──────────────────────────────────────────────────────────────
function SharedFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-900">ClassroomPath</span>
            <span className="text-slate-300">·</span>
            <span className="text-sm text-slate-500">Servicio gestionado sobre</span>
            <a
              href="https://github.com/balejosg/openpath"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-sky-700 transition hover:text-sky-600"
            >
              OpenPath ↗
            </a>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <a href="mailto:hola@classroompath.com" className="transition hover:text-slate-900">
              hola@classroompath.com
            </a>
            <span>© {new Date().getFullYear()} ClassroomPath</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function ClassroomPathLandingPage({ onNavigateToLogin }: ClassroomPathLandingPageProps) {
  const [openFaq, setOpenFaq] = React.useState<string | null>(null);

  const pillars = [
    {
      icon: <Target size={20} className="text-sky-600" />,
      title: 'Internet intencional',
      text: 'ClassroomPath convierte el acceso a Internet en una decisión pedagógica: solo lo necesario, cuando aporta valor al aprendizaje.',
    },
    {
      icon: <Layers size={20} className="text-sky-600" />,
      title: 'Menos ruido digital',
      text: 'Ayuda a reducir distracciones, navegación improductiva y fricción en el aula sin convertir el centro en un entorno de vigilancia.',
    },
    {
      icon: <Globe size={20} className="text-sky-600" />,
      title: 'Servicio gestionado',
      text: 'Un servicio que el centro contrata sin mantener infraestructura propia. Tanto la tecnología base como el propio ClassroomPath son código abierto: transparencia completa, sin cajas negras.',
    },
  ];

  const audiences = [
    'Dirección que quiere una política digital clara y defendible',
    'Equipos TIC que necesitan control real sin sobrecarga operativa',
    'Profesorado que quiere abrir recursos útiles y bloquear distracciones',
    'Centros que buscan una alternativa europea, transparente y sobria',
  ];

  const features: { icon: React.ReactNode; text: string }[] = [
    {
      icon: <Lock size={16} className="shrink-0 text-sky-600" />,
      text: 'Acceso por defecto cerrado y apertura de recursos con criterio',
    },
    {
      icon: <BookOpen size={16} className="shrink-0 text-sky-600" />,
      text: 'Políticas alineadas con el proyecto pedagógico del centro',
    },
    {
      icon: <Building2 size={16} className="shrink-0 text-sky-600" />,
      text: 'Gestión centralizada para organizaciones y varios espacios educativos',
    },
    {
      icon: <Code2 size={16} className="shrink-0 text-sky-600" />,
      text: 'Código abierto de principio a fin: OpenPath y ClassroomPath son auditables',
    },
    {
      icon: <Unlock size={16} className="shrink-0 text-sky-600" />,
      text: 'Sin vendor lock-in: el centro puede migrar a OpenPath autogestionado cuando quiera',
    },
    {
      icon: <Mail size={16} className="shrink-0 text-sky-600" />,
      text: 'Arranque guiado y soporte asíncrono por email (respuesta en 48 h)',
    },
    {
      icon: <School size={16} className="shrink-0 text-sky-600" />,
      text: 'Diseñado para entornos institucionales, no para alimentar más tiempo de pantalla',
    },
  ];

  const steps = [
    {
      step: '01',
      title: 'Definimos la política',
      text: 'Mapeamos qué recursos necesita cada etapa, aula o equipo docente.',
    },
    {
      step: '02',
      title: 'Arranque guiado',
      text: 'El centro pone en marcha ClassroomPath con una sesión de arranque guiada. La infraestructura corre de forma autónoma; no hay que mantenerla activamente día a día.',
    },
    {
      step: '03',
      title: 'Medimos foco y estabilidad',
      text: 'El centro gana una infraestructura más calmada, más gobernable y más coherente con una cultura de uso digital responsable.',
    },
  ];

  // ── Trust signals ────────────────────────────────────────────────────────────
  const trustSignals = [
    {
      label: 'Centros educativos',
      description: 'Primaria, ESO, Bachillerato y FP',
      icon: <School size={22} className="text-sky-600" />,
    },
    {
      label: 'Equipos TIC',
      description: 'Sin sobrecarga operativa',
      icon: <Building2 size={22} className="text-sky-600" />,
    },
    {
      label: 'Código abierto',
      description: 'Auditable de principio a fin',
      icon: <Code2 size={22} className="text-sky-600" />,
    },
    {
      label: 'Sin ataduras',
      description: 'Migración a OpenPath siempre posible',
      icon: <Unlock size={22} className="text-sky-600" />,
    },
  ];

  const faqs = [
    {
      q: '¿ClassroomPath promueve más uso de pantallas?',
      a: 'No. ClassroomPath está pensado para centros que quieren usar tecnología con más criterio. No vende más exposición digital; ayuda a limitar Internet a contextos y recursos que sí tienen sentido pedagógico.',
    },
    {
      q: '¿Es un filtro escolar más?',
      a: 'Es una propuesta distinta: menos enfoque en vigilancia, más enfoque en gobernanza, propósito educativo y operación fiable como servicio gestionado.',
    },
    {
      q: '¿Es software libre o propietario?',
      a: 'Ambos proyectos son de código abierto. OpenPath es el motor que gestiona el acceso a Internet. ClassroomPath es el servicio gestionado que lo envuelve, y también es auditable. Cualquiera puede revisar cómo funciona el sistema. Y si el centro decide en algún momento operar de forma autónoma, puede migrar a OpenPath sin depender de nosotros.',
    },
    {
      q: '¿Para qué centros encaja mejor?',
      a: 'Especialmente para centros con dispositivos institucionales, aulas de informática, FP, laboratorios o entornos donde el centro necesita control claro sobre el acceso a Internet.',
    },
    {
      q: '¿Cuánto tiempo lleva implantar ClassroomPath?',
      a: 'La sesión de arranque guiada cubre el primer despliegue. A partir de ahí, la infraestructura opera de forma autónoma. Los centros suelen estar operativos en la primera semana.',
    },
    {
      q: '¿Qué diferencia a ClassroomPath de un proxy o un filtro DNS estándar?',
      a: 'ClassroomPath añade gobernanza: políticas alineadas con el proyecto pedagógico, cola de solicitudes de desbloqueo para el profesorado, y una capa de operación gestionada sobre OpenPath. No es solo filtrado, es gestión de acceso con criterio.',
    },
  ];

  return (
    <div className="min-h-screen scroll-smooth bg-slate-50 text-slate-900">
      {/* ── Sticky header ── */}
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
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="text-sm font-medium text-slate-400 transition hover:text-white"
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

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-slate-900">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-2 lg:px-8 lg:py-28">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-300">
              Menos ruido digital. Más aprendizaje con criterio.
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
              La forma serena de gestionar Internet en el centro educativo.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              ClassroomPath ayuda a los centros a recuperar el control sobre el acceso a Internet en
              dispositivos institucionales. No para añadir más tecnología, sino para usarla mejor.
            </p>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-400">
              Construido sobre tecnología abierta y auditada. Desplegado y operado como servicio
              para que el centro no necesite dedicar recursos a mantenerlo. Y sin ataduras: si
              algún día el centro quiere operar por su cuenta, puede hacerlo sobre OpenPath.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#demo"
                className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/50 transition hover:bg-sky-500"
              >
                Reservar una demo
              </a>
              <a
                href="/pricing"
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Ver precios
              </a>
            </div>
          </div>

          <div className="lg:pl-8">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
              <div className="mb-6 flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-slate-700" />
                <div className="h-3 w-3 rounded-full bg-slate-800" />
                <div className="h-3 w-3 rounded-full bg-slate-800" />
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-4">
                  <div className="text-sm font-medium text-sky-300">Política del centro</div>
                  <div className="mt-2 text-sm text-slate-300">
                    Abrir solo recursos alineados con la actividad académica.
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm font-medium text-white">Lo que sí</div>
                    <ul className="mt-3 space-y-2 text-sm text-slate-400">
                      <li>• Recursos didácticos aprobados</li>
                      <li>• Herramientas necesarias para clase</li>
                      <li>• Acceso alineado con proyecto pedagógico</li>
                    </ul>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                    <div className="text-sm font-medium text-white">Lo que no</div>
                    <ul className="mt-3 space-y-2 text-sm text-slate-400">
                      <li>• Navegación improductiva</li>
                      <li>• Distracciones no curriculares</li>
                      <li>• Dependencia de supervisión constante</li>
                    </ul>
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-800/80 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-white">Resultado</span>
                    <span className="text-sky-300">Menos fricción. Más foco.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust signals ── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {trustSignals.map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-6 text-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50">
                  {item.icon}
                </div>
                <div className="text-sm font-bold text-slate-900">{item.label}</div>
                <div className="text-xs leading-5 text-slate-500">{item.description}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pillars (con icono) ── */}
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            {pillars.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                  {item.icon}
                </div>
                <div className="text-lg font-bold text-slate-900">{item.title}</div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Campaña centros públicos ── */}
      <section id="centros-publicos" className="relative overflow-hidden border-y border-emerald-200 bg-emerald-50">
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
              arranque (videollamada + guía) y soporte por email. Sin compromiso posterior.
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
      </section>

      {/* ── Por qué ahora ── */}
      <section className="mx-auto max-w-7xl bg-slate-50 px-6 py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
              Por qué ahora
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Cuando los centros quieren reducir el exceso digital, necesitan mejor infraestructura,
              no más ruido.
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600">
              ClassroomPath nace para un momento en el que muchas instituciones educativas están
              revisando el papel de las pantallas. La respuesta no es eliminar todo uso digital,
              sino hacer que el uso inevitable sea más claro, más limitado y más pedagógico.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
              Por eso hablamos de Internet intencional: un entorno donde el centro decide qué acceso
              tiene sentido y donde la tecnología deja de competir por la atención del alumnado.
            </p>
            {/* Cita destacada — integrada aquí, elimina sección "Posicionamiento" redundante */}
            <blockquote className="mt-8 rounded-xl border border-sky-100 bg-white px-6 py-5 shadow-sm">
              <p className="text-xl font-semibold leading-9 text-slate-900">
                "No somos más edtech. Somos una capa de sobriedad digital para el centro."
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Cuando haya pantalla, que haya propósito.
              </p>
            </blockquote>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-lg font-bold text-slate-900">Pensado para</div>
            <ul className="mt-6 space-y-4 text-sm leading-7 text-slate-600">
              {audiences.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-1 text-sky-600">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Features con iconos ── */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
              Qué ofrece
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Control útil para el centro. Experiencia simple para quien enseña.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {features.map((feature) => (
              <div
                key={feature.text}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium leading-7 text-slate-700"
              >
                {feature.icon}
                <span>{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Steps con conector visual ── */}
      <section id="como-funciona" className="mx-auto max-w-7xl bg-slate-50 px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
            Cómo funciona
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Una implantación pensada para centros que quieren gobernanza, no más carga operativa.
          </h2>
        </div>
        <div className="relative mt-12">
          {/* Línea conectora horizontal visible sólo en desktop */}
          <div className="absolute left-0 right-0 top-[2.6rem] hidden h-px bg-slate-200 lg:block" />
          <div className="grid gap-6 lg:grid-cols-3">
            {steps.map((item) => (
              <div
                key={item.step}
                className="relative rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-sky-200 bg-sky-50 text-sm font-bold text-sky-700">
                  {item.step}
                </div>
                <div className="text-xl font-bold text-slate-900">{item.title}</div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ con acordeón animado ── */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
              Preguntas frecuentes
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Lo que suelen preguntar los centros.
            </h2>
          </div>
          <div className="mt-10 max-w-3xl space-y-3">
            {faqs.map((item) => {
              const isOpen = openFaq === item.q;
              return (
                <div key={item.q} className="rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : item.q)}
                    className="flex w-full items-center justify-between px-6 py-5 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="text-base font-bold text-slate-900">{item.q}</span>
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[1000px] pb-6' : 'max-h-0'}`}
                  >
                    <p className="px-6 text-sm leading-7 text-slate-600">{item.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section id="demo" className="bg-slate-50 pb-24 pt-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="rounded-2xl border border-sky-100 bg-white px-8 py-16 text-center shadow-lg">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
              <ShieldCheck size={32} className="text-sky-600" />
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-sky-700">
              Pasos siguientes
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Descubre cómo sería una política de Internet más clara para tu centro.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
              Una videollamada inicial de 30 minutos para ver si encaja en tu centro. Si
              avanzamos, recibes una guía de configuración paso a paso.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <a
                href="mailto:hola@classroompath.com"
                className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-500"
                aria-label="Enviar email para hablar con el equipo de ClassroomPath"
              >
                Hablar con nosotros
              </a>
              <a
                href="/pricing"
                className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Ver precios <ArrowRight size={14} className="ml-1 inline" />
              </a>
            </div>
            <p className="mt-8 text-xs text-slate-400">
              ¿Ya tienes cuenta?{' '}
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="underline transition hover:text-slate-600"
              >
                Acceder al panel
              </button>
            </p>
          </div>
        </div>
      </section>

      <SharedFooter />
    </div>
  );
}
