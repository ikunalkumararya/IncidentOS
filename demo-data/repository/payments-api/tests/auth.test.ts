import { beforeEach, describe, expect, it } from "vitest";
import { getActiveSessionCount, issueToken, resetAuthState } from "../src/auth.js";
import { makeTokenRequest, resetAuthCounter } from "./helpers.js";

describe("issueToken", () => {
  beforeEach(() => {
    resetAuthState();
    resetAuthCounter();
  });

  it("issues a session for valid, non-MFA credentials", () => {
    const result = issueToken(
      makeTokenRequest({ account: "billing-svc@northwind.example", password: "Qu1llFerry-Batch9" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBeTruthy();
      expect(result.account).toBe("billing-svc@northwind.example");
    }
  });

  it("rejects a wrong password", () => {
    const result = issueToken(makeTokenRequest({ password: "wrong-password" }));
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("rejects an unknown account", () => {
    const result = issueToken(makeTokenRequest({ account: "nobody@northwind.example", password: "anything" }));
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("rate limits the 31st attempt from one source address within the window", () => {
    let last;
    for (let i = 0; i < 31; i++) {
      last = issueToken(makeTokenRequest({ remoteAddress: "198.51.100.9", password: "wrong-password" }));
    }
    expect(last).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("admits the same source address again once the window has passed", () => {
    for (let i = 0; i < 30; i++) {
      issueToken(
        makeTokenRequest({
          remoteAddress: "198.51.100.9",
          password: "wrong-password",
          receivedAt: 1_741_703_100_000 + i,
        }),
      );
    }
    const afterWindow = issueToken(
      makeTokenRequest({
        remoteAddress: "198.51.100.9",
        password: "wrong-password",
        receivedAt: 1_741_703_100_000 + 61_000,
      }),
    );
    expect(afterWindow).not.toEqual({ ok: false, reason: "rate_limited" });
  });

  it("requires MFA for an enrolled account and creates no session", () => {
    const result = issueToken(makeTokenRequest({ account: "ops-runner@northwind.example", password: "Trellis-Cobalt-42" }));
    expect(result).toEqual({ ok: false, reason: "mfa_required" });
    expect(getActiveSessionCount()).toBe(0);
  });
});
