import { isSupportedCurrency } from "./currency.js";
import type { PaymentBody, PaymentMethod } from "./types.js";

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

const METHODS: PaymentMethod[] = ["card", "sepa", "wallet"];

/** Largest single payment the gateway will accept, in minor units. */
export const MAX_AMOUNT_MINOR_UNITS = 1_000_000_00;

export function validatePaymentBody(body: PaymentBody): void {
  if (!body.id || typeof body.id !== "string") {
    throw new ValidationError("id is required", "id");
  }
  if (!Number.isInteger(body.amount)) {
    throw new ValidationError("amount must be an integer in minor units", "amount");
  }
  if (body.amount <= 0) {
    throw new ValidationError("amount must be positive", "amount");
  }
  if (body.amount > MAX_AMOUNT_MINOR_UNITS) {
    throw new ValidationError("amount exceeds the per-transaction limit", "amount");
  }
  if (!isSupportedCurrency(body.currency)) {
    throw new ValidationError(`unsupported currency: ${body.currency}`, "currency");
  }
  if (!body.customerId) {
    throw new ValidationError("customerId is required", "customerId");
  }
  if (!METHODS.includes(body.method)) {
    throw new ValidationError(`unsupported method: ${body.method}`, "method");
  }
}
