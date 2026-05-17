import type { AppTab } from './classroom-path-shell-routing';
import { translateClassroomPathText, type ClassroomPathT } from '../i18n/classroompath-i18n';

export interface SelectedGroupState {
  id: string;
  name: string;
  readOnly?: boolean;
}

export function getShellTitle(args: {
  activeTab: AppTab;
  admin: boolean;
  selectedGroup: SelectedGroupState | null;
  t?: ClassroomPathT;
}): string {
  const { activeTab, admin, selectedGroup } = args;
  const t = args.t ?? ((key, params) => translateClassroomPathText('en', key, params));

  switch (activeTab) {
    case 'dashboard':
      return admin ? t('app.title.dashboard.admin') : t('app.title.dashboard.user');
    case 'classrooms':
      return admin ? t('app.title.classrooms.admin') : t('app.title.classrooms.user');
    case 'groups':
      return admin ? t('app.title.groups.admin') : t('app.title.groups.user');
    case 'rules':
      return selectedGroup
        ? t('app.title.rules.group', { groupName: selectedGroup.name })
        : t('app.title.rules.default');
    case 'users':
      return admin ? t('app.title.users.admin') : t('app.title.dashboard.user');
    case 'domains':
      return t('app.title.domainRequests.admin');
    case 'settings':
      return t('app.title.settings');
    default:
      return 'ClassroomPath';
  }
}
