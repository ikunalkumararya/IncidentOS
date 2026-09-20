import { describe, expect, it } from "vitest";
import {
  formatAmount,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
  toMajorUnits,
  toMinorUnits,
} from "../src/currency.js";

describe("currency", () => {
  it("lists every certified currency", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["USD", "EUR", "GBP", "JPY"]);
  });

  it("recognises supported currencies", () => {
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("CHF")).toBe(false);
  });

  it("converts minor units to major units", () => {
    expect(toMajorUnits(1050, "USD")).toBe(10.5);
    expect(toMajorUnits(1050, "JPY")).toBe(1050);
  });

  it("converts major units to minor units", () => {
    expect(toMinorUnits(10.5, "GBP")).toBe(1050);
    expect(toMinorUnits(1050, "JPY")).toBe(1050);
  });

  it("rounds half away from zero when converting to minor units", () => {
    // Math.round(-0.5) is -0 in JavaScript, which would round a half-unit
    // debit towards zero and lose a minor unit on every refund.
    expect(toMinorUnits(0.5, "JPY")).toBe(1);
    expect(toMinorUnits(-0.5, "JPY")).toBe(-1);
  });

  it("formats amounts with the right number of decimals", () => {
    expect(formatAmount(1050, "USD")).toBe("10.50 USD");
    expect(formatAmount(1050, "JPY")).toBe("1050 JPY");
  });
});
