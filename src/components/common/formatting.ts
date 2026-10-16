import type { Locale } from "@/lib/i18n/config";
import { intlTagOf } from "@/lib/i18n/config";

/**
 * Dates are stored as calendar dates (no time of day) and must render as the
 * same day in every time zone, so they are formatted from their parts rather
 * than parsed into a `Date` that could shift across midnight.
 */
export function formatCompetitionDate(isoDate: string, locale: Locale): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat(intlTagOf(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(year, month - 1, day));
}

/**
 * A championship's Arabic name is optional, entered separately from the
 * English one (never translated automatically), so this only swaps to it on
 * an Arabic-locale page when one was actually set, falling back to the
 * English name otherwise.
 */
export function championshipDisplayName(
  name: string,
  nameAr: string | null,
  locale: Locale,
): string {
  return locale === "ar" && nameAr ? nameAr : name;
}

export function formatDateTime(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTagOf(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

/** Score or penalty, trimmed of trailing zeros. A signed value keeps its sign. */
export function formatScore(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return String(Number(numeric.toFixed(2)));
}

/** Recorded time, always with two decimals so a column of times stays aligned. */
export function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(2);
}

/** Peg size such as "6" or "2.5", without trailing zeros. */
export function formatPegSize(value: string | number): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return String(Number(numeric.toFixed(1)));
}
