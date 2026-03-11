import { defaultReportErrorSink, type ReportErrorEvent, type ReportErrorSink } from './reportError';
import { cpTrpc } from './cp-trpc';

interface ReportErrorClient {
  clientTelemetry: {
    report: {
      mutate: (event: ReportErrorEvent) => Promise<unknown>;
    };
  };
}

interface CreateReportErrorSinkOptions {
  client?: ReportErrorClient;
  fallback?: ReportErrorSink;
}

export function createReportErrorSink(options: CreateReportErrorSinkOptions = {}): ReportErrorSink {
  const client = options.client ?? (cpTrpc as unknown as ReportErrorClient);
  const fallback = options.fallback ?? defaultReportErrorSink;

  return (event) => {
    void client.clientTelemetry.report.mutate(event).catch(() => {
      fallback(event);
    });
  };
}
