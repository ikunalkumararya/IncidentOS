import type { Currency } from "./types.js";

/** Number of minor units in one major unit, per ISO 4217. */
const MINOR_UNITS: Record<Currency, number> = {
  USD: 100,
  EUR: 100,
  GBP: 100,
  JPY: 1,
};

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_UNITS) as Currency[];

export function isSupportedCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(MINOR_UNITS, value);
}

/** Converts minor units to a major-unit decimal, e.g. 1050 USD -> 10.5. */
export function toMajorUnits(amount: number, currency: Currency): number {
  return amount / MINOR_UNITS[currency];
}

/** Converts a major-unit decimal to minor units, rounding half away from zero. */
export function toMinorUnits(amount: number, currency: Currency): number {
  const scaled = amount * MINOR_UNITS[currency];
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

export function formatAmount(amount: number, currency: Currency): string {
  const major = toMajorUnits(amount, currency);
  const decimals = MINOR_UNITS[currency] === 1 ? 0 : 2;
  return `${major.toFixed(decimals)} ${currency}`;
}
