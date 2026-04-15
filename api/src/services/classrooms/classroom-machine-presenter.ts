import { calculateClassroomMachineStatus } from '../../openpath/shared.js';

export type MachineStatus = ReturnType<typeof calculateClassroomMachineStatus>;

export type ClassroomMachineListItem = {
  id: string;
  hostname: string;
  classroomId: string;
  version: string | null;
  lastSeen: string | null;
  status: MachineStatus;
};

export type OpenPathMachineRowForList = {
  id: string;
  hostname: string;
  classroomId: string | null;
  version: string | null;
  lastSeen: Date | null;
};

export function presentMachineForClassroomList(
  machine: OpenPathMachineRowForList,
  now: Date
): ClassroomMachineListItem | null {
  const classroomId = machine.classroomId;
  if (!classroomId) return null;

  return {
    id: machine.id,
    hostname: machine.hostname,
    classroomId,
    version: machine.version,
    lastSeen: machine.lastSeen?.toISOString?.() ?? null,
    status: calculateClassroomMachineStatus(machine.lastSeen ?? null, now),
  };
}

export function groupMachinesByClassroomIdForList(
  machineRows: OpenPathMachineRowForList[],
  now: Date
): Map<string, ClassroomMachineListItem[]> {
  const machinesByClassroomId = new Map<string, ClassroomMachineListItem[]>();

  for (const m of machineRows) {
    const item = presentMachineForClassroomList(m, now);
    if (!item) continue;

    const list = machinesByClassroomId.get(item.classroomId) ?? [];
    list.push(item);
    machinesByClassroomId.set(item.classroomId, list);
  }

  return machinesByClassroomId;
}
