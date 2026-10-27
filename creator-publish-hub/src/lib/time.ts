import { TIMEZONE } from "./config";

/** Offset (ms) of the zone relative to UTC at given instant. */
function zoneOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts wall-clock "YYYY-MM-DDTHH:mm" in Europe/Berlin to a UTC timestamp.
 * DST gap (non-existent time, e.g. 02:30 on spring-forward day) is shifted forward;
 * ambiguous time on fall-back day resolves to the first (summer-time) occurrence.
 */
export function berlinLocalToUtc(local: string, tz = TIMEZONE): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error(`Неверный формат даты: ${local}`);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const candidates = [zoneOffset(naive - 3 * 3600_000, tz), zoneOffset(naive + 3 * 3600_000, tz)];
  const valid = candidates.map((off) => naive - off).filter((utc) => naive - zoneOffset(utc, tz) === utc);
  if (valid.length) return Math.min(...valid);
  // Gap: use the offset before the transition, which moves the time forward.
  return naive - candidates[0];
}

export function utcToBerlinLocal(utcMs: number, tz = TIMEZONE): string {
  const d = new Date(utcMs + zoneOffset(utcMs, tz));
  return d.toISOString().slice(0, 16);
}

export function formatBerlin(utcMs: number | null | undefined): string {
  if (!utcMs) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short",
  }).format(new Date(utcMs));
}
