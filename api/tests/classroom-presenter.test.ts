import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  groupMachinesByClassroomIdForList,
  presentClassroomBase,
  presentClassroomListItem,
  presentMachineForClassroomList,
  toPublicClassroomName,
  type ClassroomMachineListItem,
} from '../src/services/classrooms/classroom-presenter.js';

describe('classroom-presenter', () => {
  describe('toPublicClassroomName', () => {
    it('prefers displayName when present', () => {
      assert.strictEqual(
        toPublicClassroomName({ name: 'cp-deadbeef00-room-0123abcd', displayName: 'Room A' }),
        'Room A'
      );
    });

    it('extracts name from scoped classroom name when no displayName', () => {
      assert.strictEqual(
        toPublicClassroomName({ name: 'cp-0123456789-lab-abcdef12', displayName: null }),
        'lab'
      );
    });
  });

  describe('presentMachineForClassroomList', () => {
    it('returns null when machine is not assigned to a classroom', () => {
      const now = new Date('2025-01-01T00:00:00.000Z');
      const item = presentMachineForClassroomList(
        {
          id: 'm1',
          hostname: 'pc-1',
          classroomId: null,
          version: '1.0.0',
          lastSeen: now,
        },
        now
      );
      assert.strictEqual(item, null);
    });

    it('computes status and serializes lastSeen', () => {
      const now = new Date('2025-01-01T00:00:00.000Z');
      const lastSeen = new Date(now.getTime() - 10 * 60 * 1000);
      const item = presentMachineForClassroomList(
        {
          id: 'm2',
          hostname: 'pc-2',
          classroomId: 'c1',
          version: null,
          lastSeen,
        },
        now
      );

      assert.ok(item);
      assert.strictEqual(item.classroomId, 'c1');
      assert.strictEqual(item.lastSeen, lastSeen.toISOString());
      assert.strictEqual(item.status, 'stale');
    });
  });

  describe('groupMachinesByClassroomIdForList', () => {
    it('groups machines by classroomId and skips unassigned machines', () => {
      const now = new Date('2025-01-01T00:00:00.000Z');
      const rows = [
        {
          id: 'm1',
          hostname: 'pc-1',
          classroomId: 'c1',
          version: null,
          lastSeen: now,
        },
        {
          id: 'm2',
          hostname: 'pc-2',
          classroomId: 'c1',
          version: null,
          lastSeen: now,
        },
        {
          id: 'm3',
          hostname: 'pc-3',
          classroomId: null,
          version: null,
          lastSeen: now,
        },
      ];

      const map = groupMachinesByClassroomIdForList(rows, now);
      assert.strictEqual(map.size, 1);
      assert.strictEqual(map.get('c1')?.length, 2);
    });
  });

  describe('presentClassroomBase', () => {
    it('computes currentGroupId/currentGroupSource using schedule fallback', () => {
      const classroom = {
        id: 'c1',
        name: 'cp-0123456789-lab-abcdef12',
        displayName: null,
        defaultGroupId: null,
        activeGroupId: null,
        captivePortalDomains: ['wifi.example'],
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      };

      const presented = presentClassroomBase({ classroom, scheduleGroupId: 'g-schedule' });
      assert.strictEqual(presented.currentGroupId, 'g-schedule');
      assert.strictEqual(presented.currentGroupSource, 'schedule');
      assert.deepStrictEqual(presented.captivePortalDomains, ['wifi.example']);
    });
  });

  describe('presentClassroomListItem', () => {
    it('computes classroom status and counts', () => {
      const classroom = {
        id: 'c1',
        name: 'cp-0123456789-lab-abcdef12',
        displayName: 'Lab',
        defaultGroupId: null,
        activeGroupId: null,
        captivePortalDomains: ['portal.school.example'],
        createdAt: null,
        updatedAt: null,
      };

      const machines: ClassroomMachineListItem[] = [
        {
          id: 'm1',
          hostname: 'pc-1',
          classroomId: 'c1',
          version: null,
          lastSeen: null,
          status: 'online',
        },
        {
          id: 'm2',
          hostname: 'pc-2',
          classroomId: 'c1',
          version: null,
          lastSeen: null,
          status: 'offline',
        },
      ];

      const presented = presentClassroomListItem({
        classroom,
        scheduleGroupId: null,
        machines,
      });

      assert.strictEqual(presented.machineCount, 2);
      assert.strictEqual(presented.onlineMachineCount, 1);
      assert.strictEqual(presented.status, 'degraded');
      assert.deepStrictEqual(presented.captivePortalDomains, ['portal.school.example']);
    });
  });
});
