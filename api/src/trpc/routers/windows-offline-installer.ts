import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { teacherOrAdminProcedure, router } from '../trpc.js';
import {
  WindowsOfflineInstallerError,
  createWindowsOfflineInstallerService,
} from '../../services/windows-offline-installer-artifact.service.js';

function toTrpcError(error: unknown): unknown {
  if (error instanceof WindowsOfflineInstallerError) {
    if (error.code === 'NOT_FOUND') {
      return new TRPCError({
        code: 'NOT_FOUND',
        message: 'Classroom not found',
      });
    }
    if (error.code === 'UNAUTHORIZED') {
      return new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Upstream authorization missing',
      });
    }
    return new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to generate offline installer',
    });
  }
  return error;
}

const generateInput = z.object({
  classroomId: z.string().min(1).max(50),
});

export const windowsOfflineInstallerRouter = router({
  generate: teacherOrAdminProcedure.input(generateInput).mutation(async ({ ctx, input }) => {
    const service = createWindowsOfflineInstallerService();

    let artifact;
    try {
      artifact = await service.generate(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.user.sub,
          classroomId: input.classroomId,
        },
        { accessToken: ctx.token }
      );
    } catch (error) {
      throw toTrpcError(error);
    }

    return {
      fileName: artifact.fileName,
      version: artifact.version,
      sha256: artifact.sha256,
      tokenExpiresAt: artifact.tokenExpiresAt,
      downloadUrl: artifact.downloadUrl,
      downloadExpiresAt: artifact.expiresAt.toISOString(),
    };
  }),
});
