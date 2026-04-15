import { calculateClassroomStatus, resolveCurrentGroup } from '../../openpath/shared.js';
import type { ClassroomMachineListItem } from './classroom-machine-presenter.js';

export type OpenPathClassroomRowForPresent = {
  id: string;
  name: string;
  displayName: string | null;
  defaultGroupId: string | null;
  activeGroupId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export function toPublicClassroomName(classroom: {
  name: string;
  displayName: string | null;
}): string {
  const displayName = classroom.displayName?.trim();
  if (displayName) return displayName;

  const scopedMatch = classroom.name.match(/^cp-[a-f0-9]{10}-(.*)-[a-f0-9]{8}$/);
  return scopedMatch?.[1] ?? classroom.name;
}

export function presentClassroomBase(params: {
  classroom: OpenPathClassroomRowForPresent;
  scheduleGroupId: string | null;
  groupDisplayNamesById?: ReadonlyMap<string, string>;
}): {
  id: string;
  name: string;
  displayName: string | null;
  defaultGroupId: string | null;
  defaultGroupDisplayName: string | null;
  activeGroupId: string | null;
  currentGroupId: string | null;
  currentGroupDisplayName: string | null;
  currentGroupSource: ReturnType<typeof resolveCurrentGroup>['source'];
  createdAt: string | null;
  updatedAt: string | null;
} {
  const c = params.classroom;
  const currentGroup = resolveCurrentGroup({
    activeGroupId: c.activeGroupId ?? null,
    scheduleGroupId: params.scheduleGroupId,
    defaultGroupId: c.defaultGroupId ?? null,
  });

  return {
    id: c.id,
    name: toPublicClassroomName(c),
    displayName: c.displayName,
    defaultGroupId: c.defaultGroupId,
    defaultGroupDisplayName: c.defaultGroupId
      ? (params.groupDisplayNamesById?.get(c.defaultGroupId) ?? null)
      : null,
    activeGroupId: c.activeGroupId,
    currentGroupId: currentGroup.id,
    currentGroupDisplayName: currentGroup.id
      ? (params.groupDisplayNamesById?.get(currentGroup.id) ?? null)
      : null,
    currentGroupSource: currentGroup.source,
    createdAt: c.createdAt?.toISOString() ?? null,
    updatedAt: c.updatedAt?.toISOString() ?? null,
  };
}

export function presentClassroomListItem(params: {
  classroom: OpenPathClassroomRowForPresent;
  scheduleGroupId: string | null;
  machines: ClassroomMachineListItem[];
  groupDisplayNamesById?: ReadonlyMap<string, string>;
}): {
  id: string;
  name: string;
  displayName: string | null;
  defaultGroupId: string | null;
  defaultGroupDisplayName: string | null;
  activeGroupId: string | null;
  currentGroupId: string | null;
  currentGroupDisplayName: string | null;
  currentGroupSource: ReturnType<typeof resolveCurrentGroup>['source'];
  machines: ClassroomMachineListItem[];
  machineCount: number;
  status: ReturnType<typeof calculateClassroomStatus>;
  onlineMachineCount: number;
  createdAt: string | null;
  updatedAt: string | null;
} {
  const base = presentClassroomBase({
    classroom: params.classroom,
    scheduleGroupId: params.scheduleGroupId,
    groupDisplayNamesById: params.groupDisplayNamesById,
  });

  const machines = params.machines;
  const onlineMachineCount = machines.filter((m) => m.status === 'online').length;
  const status = calculateClassroomStatus(machines);

  return {
    ...base,
    machines,
    machineCount: machines.length,
    status,
    onlineMachineCount,
  };
}
