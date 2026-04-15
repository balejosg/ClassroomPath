import { Building2, Layers, Rocket, School, Target, Unlock, Users } from 'lucide-react';

export const quickBenefits = [
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
] as const;

export const practicalSteps = [
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
] as const;

export const roleBenefits = [
  {
    icon: Building2,
    title: 'Dirección',
    text: 'Una política digital explicable, coherente con el proyecto educativo y aplicable de verdad.',
  },
  {
    icon: Users,
    title: 'Profesorado',
    text: 'Menos ruido en clase y un flujo claro para solicitar aperturas cuando un recurso sí tiene sentido pedagógico.',
  },
  {
    icon: School,
    title: 'Equipo TIC',
    text: 'Control de acceso por aula sin montar otra infraestructura ni convertir el mantenimiento en otra carga diaria.',
  },
] as const;

export const fitSignals = [
  {
    icon: Target,
    title: 'Filtrado web escolar por aula',
    text: 'Decidir qué recursos se permiten y cuáles no según etapa, aula o uso docente.',
  },
  {
    icon: Layers,
    title: 'Control para dispositivos del centro',
    text: 'Aplicar una política clara en portátiles, carros, aulas compartidas, laboratorios o FP.',
  },
  {
    icon: Rocket,
    title: 'Despliegue con tu equipo IT',
    text: 'Arrancar con apoyo remoto acotado sin depender de una implantación pesada por parte del proveedor.',
  },
  {
    icon: Unlock,
    title: 'Transparencia y autonomía',
    text: 'Operar sobre código abierto y conservar una salida real si el centro quiere migrar a OpenPath.',
  },
] as const;
