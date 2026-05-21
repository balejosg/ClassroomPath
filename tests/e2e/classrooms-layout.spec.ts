import { expect, test, type Page } from './fixtures/base-test';
import { loginAsAdmin, waitForNetworkIdle } from './fixtures/test-utils';
import { mockTrpcProcedures } from './fixtures/onboarding-policy';

const classrooms = Array.from({ length: 24 }, (_, index) => ({
  id: `tenant-layout-room-${index + 1}`,
  name: `Tenant Layout Room ${String(index + 1).padStart(2, '0')}`,
  displayName: `Tenant Layout Room ${String(index + 1).padStart(2, '0')}`,
  defaultGroupId: 'tenant-layout-group',
  defaultGroupDisplayName: 'Tenant Layout Group',
  activeGroup: null,
  activeGroupId: null,
  currentGroupId: 'tenant-layout-group',
  currentGroupDisplayName: 'Tenant Layout Group',
  currentGroupSource: 'default',
  status: 'operational',
  machineCount: 4,
  onlineMachineCount: 3,
  computerCount: 4,
  machines: Array.from({ length: 4 }, (_, machineIndex) => ({
    id: `tenant-layout-room-${index + 1}-machine-${machineIndex + 1}`,
    hostname: `tenant-layout-${index + 1}-${machineIndex + 1}`,
    lastSeen: '2026-05-21T08:00:00.000Z',
    status: machineIndex < 3 ? 'online' : 'offline',
  })),
}));

const schedules = Array.from({ length: 8 }, (_, index) => ({
  id: `tenant-layout-schedule-${index + 1}`,
  classroomId: 'tenant-layout-room-1',
  dayOfWeek: (index % 5) + 1,
  startTime: `${String(8 + (index % 8)).padStart(2, '0')}:00`,
  endTime: `${String(9 + (index % 8)).padStart(2, '0')}:00`,
  groupId: 'tenant-layout-group',
  groupDisplayName: 'Tenant Layout Group',
  teacherId: 'tenant-layout-teacher',
  teacherName: 'Tenant Layout Teacher',
  recurrence: 'weekly',
  createdAt: '2026-05-21T08:00:00.000Z',
  isMine: true,
  canEdit: true,
}));

const layoutGroup = {
  id: 'tenant-layout-group',
  name: 'tenant-layout-group',
  displayName: 'Tenant Layout Group',
  enabled: true,
};

async function mockClassroomPathClassrooms(page: Page): Promise<void> {
  const patches = {
    'classrooms.list': classrooms,
    'classrooms.listExemptions': [],
    'groups.list': [layoutGroup],
    'schedules.getByClassroom': { schedules, oneOffSchedules: [] },
  };

  await mockTrpcProcedures(page, patches);
  await mockTrpcProcedures(page, patches, { routeGlob: '**/trpc/**', routeMarker: '/trpc/' });
}

async function navigateToClassrooms(page: Page): Promise<void> {
  await page.goto('/classrooms');
  await waitForNetworkIdle(page).catch(() => {});
  await expect(
    page.getByRole('heading', { name: 'Tenant Layout Room 01', level: 2 })
  ).toBeVisible();
}

test.describe('ClassroomPath classrooms layout', () => {
  test.beforeEach(async ({ page }) => {
    await mockClassroomPathClassrooms(page);
    await loginAsAdmin(page);
  });

  test('keeps desktop classrooms in the SaaS shell split view @commit-smoke', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToClassrooms(page);

    const documentScroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      bodyClientHeight: document.body.clientHeight,
    }));
    expect(documentScroll.scrollHeight).toBeLessThanOrEqual(documentScroll.clientHeight + 2);
    expect(documentScroll.bodyScrollHeight).toBeLessThanOrEqual(
      documentScroll.bodyClientHeight + 2
    );

    const mainScroll = await page.getByTestId('classroompath-shell-main').evaluate((main) => ({
      scrollHeight: main.scrollHeight,
      clientHeight: main.clientHeight,
      overflowY: window.getComputedStyle(main).overflowY,
    }));
    expect(mainScroll.overflowY).toBe('hidden');
    expect(mainScroll.scrollHeight).toBeLessThanOrEqual(mainScroll.clientHeight + 2);

    const listPane = page
      .locator('div.custom-scrollbar')
      .filter({ hasText: 'Tenant Layout Room 01' })
      .first();
    const listMetrics = await listPane.evaluate((list) => ({
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
    }));
    expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight + 100);

    const listBox = await listPane.boundingBox();
    const detailBox = await page
      .getByRole('tablist', { name: /classroom detail sections/i })
      .boundingBox();
    expect(listBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(listBox!.width).toBeGreaterThan(280);
    expect(listBox!.width).toBeLessThan(380);
    expect(detailBox!.x).toBeGreaterThan(listBox!.x + listBox!.width);
  });

  test('keeps compact classrooms usable without vertical tab-selector scroll @commit-smoke', async ({
    page,
  }) => {
    for (const width of [760, 900]) {
      await page.setViewportSize({ width, height: 800 });
      await navigateToClassrooms(page);

      const listPane = page
        .locator('div.custom-scrollbar')
        .filter({ hasText: 'Tenant Layout Room 01' })
        .first();
      const listMetrics = await listPane.evaluate((list) => ({
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        overflowY: window.getComputedStyle(list).overflowY,
      }));
      expect(listMetrics.overflowY).toBe('auto');
      expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight + 100);
      expect(listMetrics.clientHeight).toBeLessThanOrEqual(360);

      const tabList = page.getByRole('tablist', { name: /classroom detail sections/i });
      const tabListBox = await tabList.boundingBox();
      expect(tabListBox).not.toBeNull();
      expect(tabListBox!.y).toBeLessThan(760);

      const tabListOverflow = await tabList.evaluate((element) => ({
        overflowX: window.getComputedStyle(element).overflowX,
        overflowY: window.getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(tabListOverflow.overflowX).toBe('auto');
      expect(tabListOverflow.overflowY).toBe('hidden');
      expect(tabListOverflow.scrollHeight).toBeLessThanOrEqual(tabListOverflow.clientHeight + 2);
    }
  });
});
