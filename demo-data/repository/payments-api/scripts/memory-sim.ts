/**
 * Measures how much heap the settlement queue actually retains under a
 * sustained burst of captures.
 *
 * This is a real measurement of whatever code is currently in src/, not a
 * fixture: IncidentOS runs it once before the patch and once after, and the
 * numbers it reports are the ones shown in the verification panel.
 *
 * Run with:  node --expose-gc --import tsx scripts/memory-sim.ts
 * Output:    a single line of JSON on stdout.
 */
import { processPayment, resetTransactionCache, getSettlementQueueDepth } from "../src/transactions.js";
import { resetAggregation } from "../src/aggregation.js";
import type { PaymentBody, PaymentRequest } from "../src/types.js";

const TRANSACTIONS = Number(process.env.MEMORY_SIM_TRANSACTIONS ?? 25_000);
const RAW_BODY_BYTES = 4096;

const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const;

function makeRequest(index: number): PaymentRequest {
  const body: PaymentBody = {
    id: `txn_${String(index).padStart(10, "0")}`,
    amount: 500 + (index % 9500),
    currency: CURRENCIES[index % CURRENCIES.length],
    customerId: `cus_${String(index % 5000).padStart(8, "0")}`,
    method: index % 3 === 0 ? "sepa" : "card",
  };

  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-request-id": `req_${body.id}`,
      "x-signature": `t=1741703520,v1=${"9f2c4b7e1a8d0c5f3b6e9a2d7c4f1b8e".repeat(2)}`,
      "user-agent": "payments-sdk-node/4.2.0",
      accept: "application/json",
      "accept-encoding": "gzip, deflate, br",
    },
    // Each request is allocated fresh, exactly as it would be per-connection.
    rawBody: new Uint8Array(RAW_BODY_BYTES).fill(0x7b),
    receivedAt: Date.now() + index,
    remoteAddress: "10.42.11.7",
  };
}

function collect(): void {
  if (typeof globalThis.gc !== "function") {
    throw new Error("memory-sim requires --expose-gc (node --expose-gc --import tsx ...)");
  }
  // Two passes: the first frees the bulk, the second collects anything
  // promoted during the first.
  globalThis.gc();
  globalThis.gc();
}

/**
 * What the container's memory limit is enforced against, not just what V8
 * reports as its heap. A raw payload is a Uint8Array, whose backing store is
 * allocated outside the V8 heap — measuring `heapUsed` alone would report a
 * comfortable-looking number for a process that is about to be OOM-killed.
 */
function retained(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.external;
}

resetTransactionCache();
resetAggregation();
collect();

const before = retained();

for (let i = 0; i < TRANSACTIONS; i++) {
  // The request goes out of scope immediately. Anything still accounted for
  // afterwards is retained by the settlement queue, not by this loop.
  processPayment(makeRequest(i));
}

collect();
const after = retained();

const retainedBytes = Math.max(0, after - before);
const usage = process.memoryUsage();

process.stdout.write(
  JSON.stringify({
    transactions: TRANSACTIONS,
    queueDepth: getSettlementQueueDepth(),
    retainedBytes,
    retainedMB: Number((retainedBytes / 1024 / 1024).toFixed(2)),
    bytesPerTransaction: Math.round(retainedBytes / TRANSACTIONS),
    breakdown: {
      heapUsedMB: Number((usage.heapUsed / 1024 / 1024).toFixed(2)),
      externalMB: Number((usage.external / 1024 / 1024).toFixed(2)),
    },
  }) + "\n",
);
