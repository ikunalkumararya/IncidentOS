import type { TokenRequest } from "../src/auth.js";
import type { PaymentBody, PaymentRequest } from "../src/types.js";

let counter = 0;

/**
 * Builds a request shaped like what the framework hands a route handler,
 * including the multi-kilobyte raw payload it keeps for signature
 * verification.
 */
export function makePaymentRequest(overrides: Partial<PaymentBody> = {}): PaymentRequest {
  const body: PaymentBody = {
    id: `txn_${String(++counter).padStart(8, "0")}`,
    amount: 1250,
    currency: "USD",
    customerId: "cus_8Fj2Kd91",
    method: "card",
    ...overrides,
  };

  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-request-id": `req_${body.id}`,
      "x-signature": "t=1741703520,v1=9f2c4b7e1a8d0c5f3b6e9a2d7c4f1b8e5a0d3c6f",
      "user-agent": "payments-sdk-node/4.2.0",
      accept: "application/json",
    },
    // 4 KiB of raw payload — the byte-for-byte body used to verify the HMAC.
    rawBody: new Uint8Array(4096).fill(0x7b),
    receivedAt: 1_741_703_520_000 + counter,
    remoteAddress: "10.42.11.7",
  };
}

export function resetRequestCounter(): void {
  counter = 0;
}

let authCounter = 0;
const AUTH_BASE_RECEIVED_AT = 1_741_703_100_000;

/**
 * Builds a token request against a known-good account by default, with a
 * monotonically increasing `receivedAt` so successive calls in a test never
 * collide on the same millisecond.
 */
export function makeTokenRequest(overrides: Partial<TokenRequest> = {}): TokenRequest {
  return {
    account: "ops-runner@northwind.example",
    password: "Trellis-Cobalt-42",
    remoteAddress: "10.42.11.7",
    receivedAt: AUTH_BASE_RECEIVED_AT + authCounter++,
    ...overrides,
  };
}

export function resetAuthCounter(): void {
  authCounter = 0;
}
