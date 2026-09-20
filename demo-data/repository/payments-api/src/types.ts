/** Currencies the payment gateway is certified for. */
export type Currency = "USD" | "EUR" | "GBP" | "JPY";

export type PaymentMethod = "card" | "sepa" | "wallet";

export interface PaymentBody {
  /** Idempotency key, also used as the transaction id. */
  id: string;
  /** Amount in minor units (cents, pence, yen). */
  amount: number;
  currency: Currency;
  customerId: string;
  method: PaymentMethod;
  metadata?: Record<string, string>;
}

/**
 * An inbound HTTP request as the framework hands it to a route handler.
 *
 * Note the weight of this object: `rawBody` holds the exact bytes received off
 * the socket (the gateway needs them to verify the HMAC signature and they can
 * be several kilobytes), and `headers` carries the full header map. A
 * `PaymentRequest` is two to three orders of magnitude larger than the handful
 * of fields settlement actually needs.
 */
export interface PaymentRequest {
  body: PaymentBody;
  headers: Record<string, string>;
  /** Raw payload bytes, retained by the framework for signature verification. */
  rawBody: Uint8Array;
  receivedAt: number;
  remoteAddress: string;
}

/**
 * The only fields downstream settlement reads. Roughly 80 bytes retained,
 * against several kilobytes for the request it was derived from.
 */
export interface TransactionSummary {
  id: string;
  amount: number;
  currency: Currency;
  capturedAt: number;
}

export interface AggregationResult {
  transactionId: string;
  /** Running total for this currency within the current settlement period. */
  runningTotal: number;
  currency: Currency;
  count: number;
}
