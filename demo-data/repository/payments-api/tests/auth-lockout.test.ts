import { beforeEach, describe, expect, it } from "vitest";
import { getActiveSessionCount, issueToken, resetAuthState } from "../src/auth.js";

/**
 * `issueToken` only throttles by source address (`PER_IP_LIMIT` per
 * `AUTH_WINDOW_MS`). An attacker who distributes guesses across many
 * addresses never trips that throttle no matter how many passwords they try
 * against a single account — the account itself has no independent failure
 * budget.
 *
 * 25 wrong-password attempts from 25 distinct addresses is far above any
 * sane per-account lockout threshold (5-10 failures), so any reasonable fix
 * makes this pass: the 26th attempt, with the *correct* password from yet
 * another address, must still be rejected once the account has failed this
 * many times in the last minute.
 */
describe("account-level lockout", () => {
  beforeEach(() => {
    resetAuthState();
  });

  it("locks out an account after many distributed wrong-password attempts, even under the per-IP limit", () => {
    const account = "billing-svc@northwind.example";
    const baseReceivedAt = 1_741_703_100_000;

    for (let i = 1; i <= 25; i++) {
      issueToken({
        account,
        password: "wrong-password",
        remoteAddress: `203.0.113.${i}`,
        receivedAt: baseReceivedAt + i * 1000,
      });
    }

    const result = issueToken({
      account,
      password: "Qu1llFerry-Batch9",
      remoteAddress: "203.0.113.26",
      receivedAt: baseReceivedAt + 26_000,
    });

    expect(result.ok).toBe(false);
    expect(getActiveSessionCount()).toBe(0);
  });
});
