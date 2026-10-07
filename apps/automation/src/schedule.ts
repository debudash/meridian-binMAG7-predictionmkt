/**
 * America/New_York calendar gates for create (~08:00) and settle (≥16:00 ET).
 * Pure helpers — unit-tested without RPC.
 */
import { ET_TZ } from "./config";

export interface EtParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** YYYY-MM-DD in ET */
  dateKey: string;
}

export function getEtParts(now: Date = new Date(), timeZone: string = ET_TZ): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  // hour12:false can still yield "24" in some engines for midnight — normalize.
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** True when ET local time is in the morning create window [createHour, createHour+1). */
export function isCreateWindow(now: Date, createHourEt: number = 8): boolean {
  const p = getEtParts(now);
  return p.hour === createHourEt;
}

/**
 * Calendar settle gate: refuse settle before settleHour ET on the calendar day.
 * Product invariant: ≥16:00 America/New_York (DEPLOY / D-017).
 */
export function canSettleCalendar(now: Date, settleHourEt: number = 16): boolean {
  const p = getEtParts(now);
  return p.hour >= settleHourEt;
}

/** Reject settle in calendar mode before the ET gate. */
export function assertSettleAllowedCalendar(now: Date, settleHourEt: number = 16): void {
  if (!canSettleCalendar(now, settleHourEt)) {
    const p = getEtParts(now);
    throw new Error(
      `Calendar settle rejected: ${p.hour}:${String(p.minute).padStart(2, "0")} ET < ${settleHourEt}:00 ET gate`
    );
  }
}

/**
 * Compute today's 16:00:00 ET as unix seconds (approx via iterative offset).
 * Used as default expiry_ts for morning-created markets.
 */
export function expiryTsForEtClose(now: Date = new Date(), settleHourEt: number = 16): number {
  const p = getEtParts(now);
  // Build a UTC guess and refine with ET parts.
  // Start from UTC noon on the ET calendar day, then search for matching ET hour.
  const utcGuess = Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0);
  for (let deltaMin = -18 * 60; deltaMin <= 18 * 60; deltaMin++) {
    const candidate = new Date(utcGuess + deltaMin * 60_000);
    const cp = getEtParts(candidate);
    if (
      cp.year === p.year &&
      cp.month === p.month &&
      cp.day === p.day &&
      cp.hour === settleHourEt &&
      cp.minute === 0 &&
      cp.second === 0
    ) {
      return Math.floor(candidate.getTime() / 1000);
    }
  }
  // Fallback: use current unix + hours-until-settle (less precise across DST).
  const hoursUntil = settleHourEt - p.hour;
  const secs =
    Math.floor(now.getTime() / 1000) +
    hoursUntil * 3600 -
    p.minute * 60 -
    p.second;
  return secs;
}
