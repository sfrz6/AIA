import { Decimal } from "decimal.js";

/**
 * Scoring uses exact decimal arithmetic. Tent pegging points move in steps of 2
 * and time penalties in steps of 0.5, while recorded times carry two decimals.
 * IEEE-754 binary floating point cannot represent those tenths exactly, and the
 * penalty formula rounds the time excess upwards, so a representation error as
 * small as 1e-16 would change a penalty by a full 0.5 points. Every scoring
 * computation therefore runs through Decimal.
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Numeric = Decimal | number | string;

export function dec(value: Numeric): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export const ZERO = new Decimal(0);

/** Serialises a scoring value for storage in a PostgreSQL NUMERIC column. */
export function toNumericString(value: Decimal, decimalPlaces = 2): string {
  return value.toFixed(decimalPlaces);
}

/** Formats a scoring value for display, trimming trailing zeros ("7.5", "12"). */
export function formatPoints(value: Numeric): string {
  const d = dec(value);
  return d.toDecimalPlaces(2).toString();
}

/** Formats a recorded time for display, always with two decimals ("7.25"). */
export function formatSeconds(value: Numeric): string {
  return dec(value).toFixed(2);
}
