import { describe, expect, it, vi } from 'vitest';

import type { ReportErrorEvent } from '../reportError';
import { createReportErrorSink } from '../reportErrorSink';

function buildEvent(): ReportErrorEvent {
  return {
    app: 'classroompath-spa',
    message: 'Failed to login',
    route: '/login',
    action: 'login',
    userRole: 'anonymous',
    meta: {
      source: 'LoginForm',
    },
    error: {
      name: 'Error',
      message: 'bad password',
      code: 'UNAUTHORIZED',
    },
    timestamp: '2026-03-11T10:00:00.000Z',
  };
}

describe('createReportErrorSink', () => {
  it('forwards structured events to the backend telemetry client', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true });
    const fallback = vi.fn();
    const sink = createReportErrorSink({
      client: {
        clientTelemetry: {
          report: {
            mutate,
          },
        },
      },
      fallback,
    });

    sink(buildEvent());

    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(buildEvent());
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back locally when the telemetry client rejects the event', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('telemetry unavailable'));
    const fallback = vi.fn();
    const sink = createReportErrorSink({
      client: {
        clientTelemetry: {
          report: {
            mutate,
          },
        },
      },
      fallback,
    });

    const event = buildEvent();
    sink(event);

    await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
    expect(fallback).toHaveBeenCalledWith(event);
  });
});
