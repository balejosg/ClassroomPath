import React from 'react';
import { ShieldCheck, ArrowRight } from 'lucide-react';

interface ClassroomPathLandingPageProps {
  onNavigateToLogin: () => void;
}

export function ClassroomPathLandingPage({ onNavigateToLogin }: ClassroomPathLandingPageProps) {
  const pillars = [
    {
      title: 'Internet intencional',
      text: 'ClassroomPath convierte el acceso a Internet en una decisión pedagógica: solo lo necesario, cuando aporta valor al aprendizaje.',
    },
    {
      title: 'Menos ruido digital',
      text: 'Ayuda a reducir distracciones, navegación improductiva y fricción en el aula sin convertir el centro en un entorno de vigilancia.',
    },
    {
      title: 'Servicio gestionado',
      text: 'Basado en OpenPath, ClassroomPath resuelve el mantenimiento e infraestructura para equipos educativos que necesitan fiabilidad, no complejidad.',
    },
  ];

  const audiences = [
    'Dirección que quiere una política digital clara y defendible',
    'Equipos TIC que necesitan control real sin sobrecarga operativa',
    'Profesorado que quiere abrir recursos útiles y bloquear distracciones',
    'Centros que buscan una alternativa europea, transparente y sobria',
  ];

  const features = [
    'Acceso por defecto cerrado y apertura de recursos con criterio',
    'Políticas alineadas con el proyecto pedagógico del centro',
    'Gestión centralizada para organizaciones y varios espacios educativos',
    'Base técnica transparente sobre OpenPath',
    'Implementación y soporte como servicio gestionado',
    'Diseñado para entornos institucionales, no para alimentar más tiempo de pantalla',
  ];

  const steps = [
    {
      step: '01',
      title: 'Definimos la política',
      text: 'Mapeamos qué recursos necesita cada etapa, aula o equipo docente.',
    },
    {
      step: '02',
      title: 'Desplegamos y operamos',
      text: 'Configuramos ClassroomPath como servicio gestionado para que el centro no tenga que sostener la complejidad técnica.',
    },
    {
      step: '03',
      title: 'Medimos foco y estabilidad',
      text: 'El centro gana una infraestructura más calmada, más gobernable y más coherente con una cultura de uso digital responsable.',
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
      q: '¿Qué relación tiene con OpenPath?',
      a: 'OpenPath es la base tecnológica. ClassroomPath es la capa de servicio gestionado: despliegue, operación, soporte y experiencia pensada para instituciones educativas.',
    },
    {
      q: '¿Para qué centros encaja mejor?',
      a: 'Especialmente para centros con dispositivos institucionales, aulas de informática, FP, laboratorios o entornos donde el centro necesita control claro sobre el acceso a Internet.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* NAVBAR */}
      <section className="bg-slate-900 border-b border-white/10 relative z-20">
        <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-900/50">
                <ShieldCheck size={24} className="text-white" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white">
                  ClassroomPath
                </div>
                <div className="text-sm text-slate-400">Transparencia basada en Software Libre</div>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="text-sm font-medium text-slate-300 hover:text-white transition"
              >
                Acceder
              </button>
              <a
                href="#demo"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 shadow-lg shadow-blue-900/50"
              >
                Solicitar demo
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* HERO (DARK) */}
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
            <div className="mb-4 inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-blue-300">
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
              Un servicio gestionado construido sobre OpenPath para crear entornos digitales más
              enfocados, más gobernables y más coherentes con la nueva sensibilidad educativa frente
              al exceso de pantallas.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#demo"
                className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/50 transition hover:bg-blue-700"
              >
                Reservar una demo
              </a>
              <a
                href="#como-funciona"
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Ver cómo funciona
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
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                  <div className="text-sm font-medium text-blue-300">Política del centro</div>
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
                    <span className="text-blue-300">Menos fricción. Más foco.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PILLARS (LIGHT) */}
      <section className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            {pillars.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="text-lg font-bold text-slate-900">{item.title}</div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY NOW (LIGHT) */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8 bg-slate-50">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">
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
              tiene sentido y dónde la tecnología deja de competir por la atención del alumnado.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="text-lg font-bold text-slate-900">Pensado para</div>
            <ul className="mt-6 space-y-4 text-sm leading-7 text-slate-600">
              {audiences.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-1 text-blue-600">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* WHAT IT OFFERS (LIGHT) */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">
              Qué ofrece
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Control útil para el centro. Experiencia simple para quien enseña.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {features.map((feature) => (
              <div
                key={feature}
                className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-700 font-medium"
              >
                {feature}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS (LIGHT) */}
      <section id="como-funciona" className="mx-auto max-w-7xl px-6 py-20 lg:px-8 bg-slate-50">
        <div className="max-w-3xl">
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">
            Cómo funciona
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Una implantación pensada para centros que quieren gobernanza, no más carga operativa.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {steps.map((item) => (
            <div
              key={item.step}
              className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
            >
              <div className="text-sm font-bold text-blue-600">{item.step}</div>
              <div className="mt-4 text-xl font-bold text-slate-900">{item.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* POSITIONING (MIXED TO DARK) */}
      <section className="border-y border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div>
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
                Posicionamiento
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                No somos “más edtech”. Somos una capa de sobriedad digital para el centro.
              </h2>
              <p className="mt-6 text-base leading-8 text-slate-300">
                ClassroomPath no compite por atención. No busca multiplicar apps, contenidos o
                estímulos. Su papel es hacer posible una política digital más tranquila y defendible
                para equipos directivos, docentes y familias.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
              <div className="text-sm font-medium text-slate-400">En una frase</div>
              <p className="mt-4 text-2xl font-semibold leading-10 text-white">
                “Cuando haya pantalla, que haya propósito.”
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ (LIGHT) */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8 bg-slate-50">
        <div className="max-w-3xl">
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">
            Preguntas frecuentes
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Lo que suelen preguntar los centros.
          </h2>
        </div>
        <div className="mt-10 space-y-4">
          {faqs.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-bold text-slate-900">{item.q}</div>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA (LIGHT) */}
      <section id="demo" className="pb-24 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="rounded-2xl border border-blue-100 bg-white px-8 py-16 text-center shadow-lg">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
              <ShieldCheck size={32} className="text-blue-600" />
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">
              Pasos siguientes
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Descubre cómo sería una política de Internet más clara para tu centro.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-600">
              Te mostramos cómo implantar ClassroomPath, qué tipo de centros encajan mejor y cómo
              plantear un piloto sin añadir complejidad innecesaria al equipo.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <a
                href="mailto:hola@classroompath.com"
                className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-md transition hover:bg-blue-700"
              >
                Hablar con nosotros
              </a>
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 flex items-center gap-2"
              >
                Acceder al panel <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
