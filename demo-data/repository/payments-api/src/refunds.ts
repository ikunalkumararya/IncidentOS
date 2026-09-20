import { ValidationError } from "./validation.js";
import type { Currency } from "./types.js";

export interface RefundRequest {
  transactionId: string;
  /** Amount to refund in minor units. Omit for a full refund. */
  amount?: number;
  currency: Currency;
  reason?: string;
}

export interface Refund {
  transactionId: string;
  amount: number;
  currency: Currency;
  partial: boolean;
  reason: string;
}

/**
 * Computes a refund against an original capture.
 *
 * Rounding was corrected in v1.8.2: partial refunds are floored to the nearest
 * minor unit so the sum of partial refunds can never exceed the capture.
 */
export function computeRefund(
  request: RefundRequest,
  originalAmount: number,
  alreadyRefunded = 0,
): Refund {
  if (originalAmount <= 0) {
    throw new ValidationError("original amount must be positive", "originalAmount");
  }

  const remaining = originalAmount - alreadyRefunded;
  if (remaining <= 0) {
    throw new ValidationError("transaction is already fully refunded", "transactionId");
  }

  const requested = request.amount ?? remaining;
  if (requested <= 0) {
    throw new ValidationError("refund amount must be positive", "amount");
  }

  const amount = Math.floor(requested);
  if (amount > remaining) {
    throw new ValidationError("refund exceeds the remaining refundable amount", "amount");
  }

  return {
    transactionId: request.transactionId,
    amount,
    currency: request.currency,
    partial: amount < remaining,
    reason: request.reason ?? "requested_by_customer",
  };
}
