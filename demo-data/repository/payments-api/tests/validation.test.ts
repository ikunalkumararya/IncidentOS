import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR_UNITS, validatePaymentBody, ValidationError } from "../src/validation.js";
import type { PaymentBody } from "../src/types.js";

const valid: PaymentBody = {
  id: "txn_00000001",
  amount: 1250,
  currency: "USD",
  customerId: "cus_8Fj2Kd91",
  method: "card",
};

const withOverride = (overrides: Partial<PaymentBody>) => () =>
  validatePaymentBody({ ...valid, ...overrides } as PaymentBody);

describe("validatePaymentBody", () => {
  it("accepts a well-formed payment", () => {
    expect(() => validatePaymentBody(valid)).not.toThrow();
  });

  it("rejects a missing id", () => {
    expect(withOverride({ id: "" })).toThrow(ValidationError);
  });

  it("rejects a non-integer amount", () => {
    expect(withOverride({ amount: 12.5 })).toThrow(/integer/);
  });

  it("rejects a zero or negative amount", () => {
    expect(withOverride({ amount: 0 })).toThrow(/positive/);
    expect(withOverride({ amount: -100 })).toThrow(/positive/);
  });

  it("rejects an amount over the per-transaction limit", () => {
    expect(withOverride({ amount: MAX_AMOUNT_MINOR_UNITS + 1 })).toThrow(/limit/);
  });

  it("rejects an unsupported currency", () => {
    expect(withOverride({ currency: "CHF" as never })).toThrow(/unsupported currency/);
  });

  it("rejects a missing customerId", () => {
    expect(withOverride({ customerId: "" })).toThrow(/customerId/);
  });

  it("reports the offending field on the error", () => {
    try {
      validatePaymentBody({ ...valid, method: "crypto" as never });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("method");
    }
  });
});
