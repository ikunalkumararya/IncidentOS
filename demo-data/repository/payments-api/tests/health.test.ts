import { beforeEach, describe, expect, it } from "vitest";
import { buildHealthReport, QUEUE_DEPTH_WARNING, VERSION } from "../src/health.js";
import { processPayment, resetTransactionCache } from "../src/transactions.js";
import { resetAggregation } from "../src/aggregation.js";
import { makePaymentRequest, resetRequestCounter } from "./helpers.js";

describe("buildHealthReport", () => {
  beforeEach(() => {
    resetTransactionCache();
    resetAggregation();
    resetRequestCounter();
  });

  it("reports ok when every check passes", () => {
    expect(buildHealthReport(120, true).status).toBe("ok");
  });

  it("reports degraded when the database is unreachable", () => {
    const report = buildHealthReport(120, false);
    expect(report.status).toBe("degraded");
    expect(report.checks.database).toBe("fail");
  });

  it("echoes the running version", () => {
    expect(buildHealthReport(1, true).version).toBe(VERSION);
  });

  it("echoes the uptime it was given", () => {
    expect(buildHealthReport(3600, true).uptimeSeconds).toBe(3600);
  });

  it("reports the current settlement queue depth", () => {
    processPayment(makePaymentRequest());
    processPayment(makePaymentRequest());
    expect(buildHealthReport(10, true).settlementQueueDepth).toBe(2);
  });

  it("passes the settlement queue check well below the warning threshold", () => {
    processPayment(makePaymentRequest());
    const report = buildHealthReport(10, true);
    expect(report.settlementQueueDepth).toBeLessThan(QUEUE_DEPTH_WARNING);
    expect(report.checks.settlementQueue).toBe("pass");
  });
});
