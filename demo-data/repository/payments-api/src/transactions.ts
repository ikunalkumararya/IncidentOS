import { aggregateTransaction } from "./aggregation.js";
import { validatePaymentBody } from "./validation.js";
import type { AggregationResult, PaymentRequest, TransactionSummary } from "./types.js";

/**
 * Transactions captured during the current settlement period.
 *
 * The settlement worker drains this queue on its own schedule (end of the
 * settlement period, or when a batch limit is reached upstream), so within a
 * period the queue is expected to grow with traffic. That is by design and is
 * safe *as long as each entry stays small* — settlement only ever reads the id,
 * the amount and the currency.
 *
 * Added in v1.8.4 for settlement batching.
 */
const transactionCache: PaymentRequest[] = [];

/**
 * Captures a payment: validates it, queues it for settlement, and folds it
 * into the running aggregate.
 */
export function processPayment(req: PaymentRequest): AggregationResult {
  validatePaymentBody(req.body);

  transactionCache.push(req);

  return aggregateTransaction(req.body);
}

/** Number of transactions waiting to be settled. */
export function getSettlementQueueDepth(): number {
  return transactionCache.length;
}

/** Read-only view of the queue. Used by diagnostics and tests. */
export function peekSettlementQueue(): readonly unknown[] {
  return transactionCache;
}

/** Removes and returns everything queued. Called by the settlement worker. */
export function drainSettlementBatch(): TransactionSummary[] {
  return transactionCache.splice(0, transactionCache.length) as unknown as TransactionSummary[];
}

/** Test/bootstrap helper. */
export function resetTransactionCache(): void {
  transactionCache.length = 0;
}
