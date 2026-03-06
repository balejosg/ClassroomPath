// Scheduling uses dayOfWeek + start/end times without timezone.
// To make "current schedule" deterministic in Docker (which often defaults to UTC),
// compute "now" in an explicit timezone.
const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || process.env.TZ || 'Europe/Madrid';

const WEEKDAY_BY_SHORT_EN: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getScheduleClock(date: Date): { dayOfWeek: number; timeHHMM: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULE_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hourPartRaw = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;

    const dayOfWeek =
      weekday && WEEKDAY_BY_SHORT_EN[weekday] !== undefined
        ? WEEKDAY_BY_SHORT_EN[weekday]
        : date.getDay();
    const hourPart = hourPartRaw === '24' ? '00' : hourPartRaw;
    const timeHHMM =
      hourPart && minutePart ? `${hourPart}:${minutePart}` : date.toTimeString().slice(0, 5);

    return { dayOfWeek, timeHHMM };
  } catch {
    return { dayOfWeek: date.getDay(), timeHHMM: date.toTimeString().slice(0, 5) };
  }
}

export function normalizeTimeHHMM(t: string | null): string {
  const parts = String(t).split(':');
  const hh = parts[0];
  const mm = parts[1];
  if (hh !== undefined && mm !== undefined) return `${hh}:${mm}`;
  return String(t);
}

export function parseTimeToMinutes(t: string): number {
  const parts = String(t).split(':');
  const hh = parts[0];
  const mm = parts[1];
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}
