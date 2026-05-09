type TrpcEnvelope<T> = {
  result?: {
    data?: T | { json?: T };
  };
  error?: {
    message?: string;
    code?: string;
    data?: {
      code?: string;
    };
  };
};

type ParsedTrpcEnvelope<T> = {
  data?: T;
  error?: {
    message?: string;
    code?: string;
  };
};

function unwrapTrpcData<T>(data: T | { json?: T } | undefined): T | undefined {
  if (data && typeof data === 'object' && 'json' in data) {
    return data.json;
  }

  return data;
}

export function parseTrpcEnvelope<T>(payload: unknown): ParsedTrpcEnvelope<T> {
  const candidate = Array.isArray(payload) ? payload[0] : payload;
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }

  const envelope = candidate as TrpcEnvelope<T>;
  if (envelope.result !== undefined) {
    return { data: unwrapTrpcData(envelope.result.data) };
  }
  if (envelope.error !== undefined) {
    return {
      error: {
        message: envelope.error.message,
        code: envelope.error.data?.code ?? envelope.error.code,
      },
    };
  }
  return {};
}
