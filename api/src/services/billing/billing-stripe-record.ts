import type { StripeRecord } from './billing-types.js';

export function asStripeRecord(value: unknown): StripeRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as StripeRecord) : {};
}

export function getString(record: StripeRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function getBoolean(record: StripeRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

export function getNumber(record: StripeRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getUnixDate(record: StripeRecord, key: string): Date | null {
  const value = getNumber(record, key);
  return value ? new Date(value * 1000) : null;
}

export function readInvoiceCurrentPeriodEnd(invoice: StripeRecord): Date | null {
  const directPeriodEnd = getUnixDate(invoice, 'period_end');
  if (directPeriodEnd) return directPeriodEnd;

  const lines = invoice.lines;
  if (!lines || typeof lines !== 'object') return null;
  const linesRecord = asStripeRecord(lines);
  const data = linesRecord.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const firstLine = asStripeRecord(data[0]);
  const period = asStripeRecord(firstLine.period);
  return getUnixDate(period, 'end');
}
