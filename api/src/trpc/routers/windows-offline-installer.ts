import { z } from 'zod';

import { teacherOrAdminProcedure, router } from '../trpc.js';
import { generateClassroomPathWindowsOfflineInstaller } from '../../services/windows-offline-installer-integration.service.js';

const generateInput = z.object({
  classroomId: z.string().min(1).max(128),
});

export const windowsOfflineInstallerRouter = router({
  generate: teacherOrAdminProcedure.input(generateInput).mutation(async ({ ctx, input }) => {
    return generateClassroomPathWindowsOfflineInstaller({
      organizationId: ctx.organizationId,
      classroomId: input.classroomId,
      token: ctx.token,
      req: ctx.req,
    });
  }),
});
