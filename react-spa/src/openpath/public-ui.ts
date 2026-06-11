/**
 * Re-export bridge for the OpenPath public-ui surface.
 *
 * This file is the ClassroomPath wrapper's single point of contact for shared
 * UI primitives (buttons, cards, dialogs, inputs) from upstream OpenPath. Do
 * NOT edit upstream/openpath/ for wrapper work. To add or override UI
 * primitives, create new components in ClassroomPath -- never inside the
 * submodule.
 *
 * Boundary doc: docs/contracts/openpath-public-surface.md
 */
export {
  Button,
  Card,
  ConfirmDialog,
  DangerConfirmDialog,
  Input,
  Modal,
} from '@openpath/public-ui';
