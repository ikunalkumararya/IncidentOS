import type { AggregationResult, Currency, PaymentBody } from "./types.js";

/**
 * Running per-currency totals for the current settlement period.
 *
 * This is bounded by the number of supported currencies, so it does not grow
 * with traffic. Added in v1.8.4 alongside the settlement queue.
 */
const runningTotals = new Map<Currency, { total: number; count: number }>();

export function aggregateTransaction(body: PaymentBody): AggregationResult {
  const current = runningTotals.get(body.currency) ?? { total: 0, count: 0 };
  const next = { total: current.total + body.amount, count: current.count + 1 };
  runningTotals.set(body.currency, next);

  return {
    transactionId: body.id,
    runningTotal: next.total,
    currency: body.currency,
    count: next.count,
  };
}

export function getRunningTotal(currency: Currency): number {
  return runningTotals.get(currency)?.total ?? 0;
}

export function getTransactionCount(currency: Currency): number {
  return runningTotals.get(currency)?.count ?? 0;
}

export function getAggregatedCurrencies(): Currency[] {
  return [...runningTotals.keys()].sort();
}

/** Called by the settlement worker when a settlement period closes. */
export function resetAggregation(): void {
  runningTotals.clear();
}
