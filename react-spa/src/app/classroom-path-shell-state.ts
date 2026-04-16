import type { AppTab } from './classroom-path-shell-routing';

export interface SelectedGroupState {
  id: string;
  name: string;
  readOnly?: boolean;
}

export function getShellTitle(args: {
  activeTab: AppTab;
  admin: boolean;
  selectedGroup: SelectedGroupState | null;
}): string {
  const { activeTab, admin, selectedGroup } = args;

  switch (activeTab) {
    case 'dashboard':
      return admin ? 'Vista General' : 'Mi Panel';
    case 'classrooms':
      return admin ? 'Gestión de Aulas' : 'Aulas';
    case 'groups':
      return admin ? 'Grupos y Políticas' : 'Mis Políticas';
    case 'rules':
      return selectedGroup ? `Reglas: ${selectedGroup.name}` : 'Gestión de Reglas';
    case 'users':
      return admin ? 'Administración de Usuarios' : 'Mi Panel';
    case 'domains':
      return 'Solicitudes de Acceso';
    case 'settings':
      return 'Configuración';
    default:
      return 'ClassroomPath';
  }
}
