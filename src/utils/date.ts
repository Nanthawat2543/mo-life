import { config } from "../config";

const TZ = config.timezone;

/** Current time as a Date (UTC instant; format with TZ-aware helpers below). */
export function now(): Date {
  return new Date();
}

/** "YYYY-MM-DD" for a given instant, in the configured timezone. */
export function toLocalDateStr(d: Date): string {
  // en-CA gives ISO-like YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "HH:mm" for a given instant, in the configured timezone (24h). */
export function toLocalTimeStr(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function todayISO(): string {
  return toLocalDateStr(now());
}

export function addDaysISO(days: number): string {
  const d = now();
  d.setUTCDate(d.getUTCDate() + days);
  return toLocalDateStr(d);
}

export function tomorrowISO(): string {
  return addDaysISO(1);
}

export function dayAfterTomorrowISO(): string {
  return addDaysISO(2);
}

/** End of the current week (Sunday) in local date string. */
export function endOfWeekISO(): string {
  const todayStr = todayISO();
  const [y, m, d] = todayStr.split("-").map(Number);
  // Use noon UTC to avoid DST/edge issues, then walk forward to Sunday.
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = base.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? 0 : 7 - dow;
  base.setUTCDate(base.getUTCDate() + diff);
  return toLocalDateStr(base);
}

/**
 * Given a Notion date string (may be date-only or datetime with offset),
 * return { date: "YYYY-MM-DD", time: "HH:mm" | null } in local timezone.
 */
export function splitNotionDate(raw: string | null | undefined): {
  date: string | null;
  time: string | null;
} {
  if (!raw) return { date: null, time: null };
  // Date-only (length 10, no time component)
  if (raw.length <= 10) return { date: raw, time: null };
  const d = new Date(raw);
  return { date: toLocalDateStr(d), time: toLocalTimeStr(d) };
}

/**
 * Build a Notion-storable ISO datetime string in the configured tz offset.
 * For Asia/Bangkok this is +07:00 (no DST).
 */
export function toNotionDateTime(date: string, time: string): string {
  const offset = tzOffsetString();
  return `${date}T${time}:00${offset}`;
}

/** e.g. "+07:00" for Asia/Bangkok. Computed from the runtime, DST-aware. */
export function tzOffsetString(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "longOffset",
  }).formatToParts(now());
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+07:00";
  // name like "GMT+07:00"
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+07:00";
}

/**
 * Parse a Thai free-text date/time out of a string.
 * Recognises วันนี้/พรุ่งนี้/มะรืน, dd/mm, yyyy-mm-dd, HH:mm.
 */
export function parseThaiDate(text: string): {
  date: string;
  time: string | null;
} {
  let date = todayISO();
  let time: string | null = null;

  if (/วันนี้/.test(text)) date = todayISO();
  else if (/มะรืน/.test(text)) date = dayAfterTomorrowISO();
  else if (/พรุ่งนี้/.test(text)) date = tomorrowISO();

  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) date = isoMatch[1];

  const dmMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (dmMatch) {
    const day = dmMatch[1].padStart(2, "0");
    const month = dmMatch[2].padStart(2, "0");
    const year = todayISO().slice(0, 4);
    date = `${year}-${month}-${day}`;
  }

  const timeMatch = text.match(/(\d{1,2})[:.](\d{2})/);
  if (timeMatch) {
    time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  }

  return { date, time };
}

/** Friendly Thai date label, e.g. "ศุกร์ 30 พ.ค.". */
export function thaiDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 5)); // noon-ish Bangkok
  const days = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${days[dt.getUTCDay()]} ${d} ${months[m - 1]}`;
}
