/**
 * Re-export bridge for the OpenPath public-shell surface.
 *
 * This file is the ClassroomPath wrapper's single point of contact for shell
 * components (sidebar, header, dashboard, routes) from upstream OpenPath. Do
 * NOT edit upstream/openpath/ for wrapper work. To add or override shell
 * layout, wrap the exported components here or in ClassroomPathShell.tsx --
 * never inside the submodule.
 *
 * Boundary doc: docs/contracts/openpath-public-surface.md
 */
export {
  Classrooms,
  Dashboard,
  DomainRequests,
  Groups,
  Header,
  RulesManager,
  Settings,
  Sidebar,
  TeacherDashboard,
} from '@openpath/public-shell';
