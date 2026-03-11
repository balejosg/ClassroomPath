import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportError, setReportErrorSink, type ReportErrorEvent } from '../reportError';
import { createReportErrorSink } from '../reportErrorSink';

describe('reportError', () => {
  afterEach(() => {
    setReportErrorSink(null);
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('emits a structured payload to the configured sink', () => {
    window.history.pushState({}, '', '/login');
    const err = new Error('boom');
    const sink = vi.fn();
    setReportErrorSink(sink as (event: ReportErrorEvent) => void);

    reportError('Something failed', err, {
      source: 'test',
      attempt: 2,
      action: 'login',
      userRole: 'anonymous',
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const payload = sink.mock.calls[0]?.[0];
    expect(payload?.app).toBe('classroompath-spa');
    expect(payload?.message).toBe('Something failed');
    expect(payload?.route).toBe('/login');
    expect(payload?.action).toBe('login');
    expect(payload?.userRole).toBe('anonymous');
    expect(payload?.meta).toEqual({
      source: 'test',
      attempt: 2,
      action: 'login',
      userRole: 'anonymous',
    });
    expect(payload?.error.message).toBe('boom');
    expect(typeof payload?.timestamp).toBe('string');
  });

  it('falls back to console.error when no sink is configured', () => {
    const err = new Error('boom');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportError('Something failed', err);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      app: 'classroompath-spa',
      message: 'Something failed',
      route: '/',
      meta: {},
    });
  });

  it('sends structured events to the backend telemetry sink when installed', async () => {
    window.history.pushState({}, '', '/login');
    const mutate = vi.fn().mockResolvedValue({ success: true });
    const fallback = vi.fn();

    setReportErrorSink(
      createReportErrorSink({
        client: {
          clientTelemetry: {
            report: {
              mutate,
            },
          },
        },
        fallback,
      })
    );

    reportError('Failed to login', new Error('bad password'), {
      action: 'login',
      userRole: 'anonymous',
      source: 'LoginForm',
    });

    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      app: 'classroompath-spa',
      message: 'Failed to login',
      route: '/login',
      action: 'login',
      userRole: 'anonymous',
      meta: {
        action: 'login',
        userRole: 'anonymous',
        source: 'LoginForm',
      },
      error: {
        name: 'Error',
        message: 'bad password',
      },
    });
    expect(typeof mutate.mock.calls[0]?.[0]?.timestamp).toBe('string');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('includes error codes when the error object exposes one', () => {
    const err = new Error('expired') as Error & { code?: string };
    err.code = 'INVITATION_EXPIRED';
    const sink = vi.fn();
    setReportErrorSink(sink as (event: ReportErrorEvent) => void);

    reportError('Invitation failed', err);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]?.error).toMatchObject({
      name: 'Error',
      message: 'expired',
      code: 'INVITATION_EXPIRED',
    });
  });

  it('normalizes string and unknown error values', () => {
    const sink = vi.fn();
    setReportErrorSink(sink as (event: ReportErrorEvent) => void);

    reportError('String failure', 'plain-text failure');
    reportError('Unknown failure', { ok: false });

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0]?.[0]?.error).toEqual({ message: 'plain-text failure' });
    expect(sink.mock.calls[1]?.[0]?.error).toEqual({ message: 'Unknown error' });
  });
});
