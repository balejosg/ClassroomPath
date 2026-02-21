import winston from 'winston';

interface ChildLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

interface LogMeta {
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp as string} ${level}: ${message as string}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(winston.format.timestamp(), winston.format.json());

const baseLogger = winston.createLogger({
  level: logLevel,
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'classroompath-gateway' },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

function createChildLogger(meta: LogMeta): ChildLogger {
  return {
    info: (message: string, extra: Record<string, unknown> = {}): void => {
      baseLogger.info(message, { ...meta, ...extra });
    },
    warn: (message: string, extra: Record<string, unknown> = {}): void => {
      baseLogger.warn(message, { ...meta, ...extra });
    },
    error: (message: string, extra: Record<string, unknown> = {}): void => {
      baseLogger.error(message, { ...meta, ...extra });
    },
    debug: (message: string, extra: Record<string, unknown> = {}): void => {
      baseLogger.debug(message, { ...meta, ...extra });
    },
  };
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>): void => {
    baseLogger.info(message, meta);
  },
  warn: (message: string, meta?: Record<string, unknown>): void => {
    baseLogger.warn(message, meta);
  },
  error: (message: string, meta?: Record<string, unknown>): void => {
    baseLogger.error(message, meta);
  },
  debug: (message: string, meta?: Record<string, unknown>): void => {
    baseLogger.debug(message, meta);
  },
  child: createChildLogger,
};
