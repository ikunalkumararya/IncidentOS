import { describe, expect, it } from "vitest";
import { computeRefund } from "../src/refunds.js";
import { ValidationError } from "../src/validation.js";

describe("computeRefund", () => {
  it("refunds the full remaining amount by default", () => {
    const refund = computeRefund({ transactionId: "txn_1", currency: "USD" }, 5000);
    expect(refund.amount).toBe(5000);
    expect(refund.partial).toBe(false);
  });

  it("marks a smaller refund as partial", () => {
    const refund = computeRefund({ transactionId: "txn_1", amount: 1500, currency: "USD" }, 5000);
    expect(refund.amount).toBe(1500);
    expect(refund.partial).toBe(true);
  });

  it("accounts for amounts already refunded", () => {
    const refund = computeRefund({ transactionId: "txn_1", currency: "USD" }, 5000, 2000);
    expect(refund.amount).toBe(3000);
  });

  it("floors fractional refunds so partials can never exceed the capture", () => {
    const refund = computeRefund({ transactionId: "txn_1", amount: 1666.9, currency: "EUR" }, 5000);
    expect(refund.amount).toBe(1666);
  });

  it("rejects a refund larger than the remaining amount", () => {
    expect(() =>
      computeRefund({ transactionId: "txn_1", amount: 4000, currency: "USD" }, 5000, 2000),
    ).toThrow(/remaining refundable/);
  });

  it("rejects refunding an already fully refunded transaction", () => {
    expect(() => computeRefund({ transactionId: "txn_1", currency: "USD" }, 5000, 5000)).toThrow(
      ValidationError,
    );
  });

  it("defaults the reason when none is given", () => {
    const refund = computeRefund({ transactionId: "txn_1", currency: "GBP" }, 100);
    expect(refund.reason).toBe("requested_by_customer");
  });
});
