export type FaqItem = {
  q: string;
  a: string;
};

// ── Landing FAQs – oriented towards concept / positioning ─────────────────────
export const LANDING_FAQS: FaqItem[] = [
  {
    q: '¿ClassroomPath promueve más uso de pantallas?',
    a: 'No. ClassroomPath está pensado para centros que quieren usar tecnología con más criterio. No vende más exposición digital; ayuda a limitar Internet a contextos y recursos que sí tienen sentido pedagógico.',
  },
  {
    q: '¿Es un filtro escolar más?',
    a: 'No es solo filtrar. ClassroomPath añade gestión: quién decide qué se abre, por qué y con qué operación se sostiene.',
  },
  {
    q: '¿Es software libre o propietario?',
    a: 'OpenPath es el motor abierto y ClassroomPath es el servicio gestionado sobre esa base. El centro puede auditar y, si lo necesita, migrar.',
  },
  {
    q: '¿Para qué centros encaja mejor?',
    a: 'Especialmente para centros con dispositivos del centro, aulas de informática, FP, laboratorios o espacios compartidos donde hace falta control claro del acceso.',
  },
  {
    q: '¿Cuánto tiempo lleva implantarlo?',
    a: 'El arranque guiado cubre el primer despliegue y los centros suelen estar operativos en la primera semana.',
  },
];

// ── Pricing FAQs – oriented towards operational / cost questions ──────────────
export const PRICING_FAQS: FaqItem[] = [
  {
    q: '¿Qué cuenta como un aula?',
    a: 'Un conjunto de hasta 30 dispositivos bajo una política de acceso definida.',
  },
  {
    q: '¿Puedo empezar con un piloto?',
    a: 'Sí. Hay un piloto de 5 aulas durante 90 días.',
  },
  {
    q: '¿El onboarding está incluido en el recurrente?',
    a: 'No. Se cobra aparte para mantener el coste anual por aula limpio y comparable.',
  },
  {
    q: '¿Por qué cobráis por aula y no por dispositivo?',
    a: 'Porque el centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  },
  {
    q: '¿Qué pasa si un aula tiene más de 30 dispositivos?',
    a: 'Se recomienda contarla como dos aulas o pasar a un tramo personalizado.',
  },
  {
    q: '¿Incluye soporte?',
    a: 'Sí, soporte estándar por email. SLA premium aparte.',
  },
  {
    q: '¿Hay opción para centros públicos?',
    a: 'Sí. Hay acceso sin coste para hasta 5 aulas mientras haya disponibilidad y se verifique titularidad pública.',
  },
  {
    q: '¿Qué diferencia a ClassroomPath de un proxy o un filtro DNS estándar?',
    a: 'ClassroomPath añade gestión: política alineada con el proyecto pedagógico, cola de solicitudes de desbloqueo y una capa de operación gestionada sobre OpenPath.',
  },
];
