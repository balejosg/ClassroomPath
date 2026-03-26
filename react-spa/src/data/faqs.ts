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
    a: 'No es solo filtrar. ClassroomPath añade gestión: quién decide qué se abre, por qué, y una operación que no depende de intervención manual constante.',
  },
  {
    q: '¿Es software libre o propietario?',
    a: 'OpenPath (el motor) y ClassroomPath (el servicio) son código abierto. Cualquiera puede auditar cómo funcionan. Y si el centro quiere operar por su cuenta, puede migrar a OpenPath sin depender de nosotros.',
  },
  {
    q: '¿Para qué centros encaja mejor?',
    a: 'Especialmente para centros con dispositivos del centro, aulas de informática, FP, laboratorios o entornos donde se necesita control claro sobre el acceso a Internet.',
  },
  {
    q: '¿Cuánto tiempo lleva implantar ClassroomPath?',
    a: 'La sesión de arranque guiada cubre el primer despliegue. A partir de ahí, la infraestructura opera de forma autónoma. Los centros suelen estar operativos en la primera semana.',
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
    a: 'Sí, hay un piloto de 5 aulas durante 90 días.',
  },
  {
    q: '¿El onboarding está incluido?',
    a: 'No. Se cobra aparte para mantener el recurrente por aula lo más bajo posible.',
  },
  {
    q: '¿Por qué cobráis por aula y no por dispositivo?',
    a: 'Porque el centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  },
  {
    q: '¿Qué pasa si un aula tiene más de 30 dispositivos?',
    a: 'Se recomienda contarla como 2 aulas o pasar a un tramo personalizado.',
  },
  {
    q: '¿Incluye soporte?',
    a: 'Sí, soporte estándar por email. SLA premium aparte.',
  },
  {
    q: '¿Hay una opción para centros públicos?',
    a: 'Sí. Hay una campaña activa de acceso gratuito para centros de titularidad pública: hasta 5 aulas sin coste mientras dure la campaña, incluyendo una sesión de arranque (videollamada + guía) y soporte estándar por email. Plazas sujetas a disponibilidad.',
  },
  {
    q: '¿Qué diferencia a ClassroomPath de un proxy o un filtro DNS estándar?',
    a: 'ClassroomPath añade gestión: políticas alineadas con el proyecto pedagógico, cola de solicitudes de desbloqueo para el profesorado y una capa de operación gestionada sobre OpenPath. No es solo filtrado, es gestión de acceso con criterio.',
  },
];
