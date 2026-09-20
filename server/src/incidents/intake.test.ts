import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { detectAnomaly, logSchema, reportSchema, validSignature } from "./intake.js";

const now = 1_800_000_000_000;
const timestamp = String(now / 1000);
const raw = Buffer.from('{"title":"Failure"}');
const secret = "test-only-webhook-secret";
const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + ".").update(raw).digest("hex");
const batch = (levels: string[]) => logSchema.parse({ eventId: "batch-1", service: "api", entries: levels.map(level => ({ timestamp: new Date(now).toISOString(), level, message: "Request completed" })) });

describe("signed intake", () => {
  it("accepts a signature for exact bytes and rejects tampering, expiry and missing configuration", () => {
    expect(validSignature(raw, timestamp, signature, secret, now)).toBe(true);
    expect(validSignature(Buffer.from("{}"), timestamp, signature, secret, now)).toBe(false);
    expect(validSignature(raw, timestamp, signature, secret, now + 301_000)).toBe(false);
    expect(validSignature(raw, timestamp, signature, "", now)).toBe(false);
    expect(validSignature(raw, timestamp, "sha256=nope", secret, now)).toBe(false);
  });
  it("rejects missing report context and oversized batches", () => {
    expect(reportSchema.safeParse({ eventId: "x", title: "Issue" }).success).toBe(false);
    expect(logSchema.safeParse({ ...batch(["info"]), entries: Array(201).fill(batch(["info"]).entries[0]) }).success).toBe(false);
  });
});
describe("log detection", () => {
  it("ignores healthy logs and isolated nonfatal errors", () => {
    expect(detectAnomaly(batch(["info", "warn", "error"]))).toBeNull();
    expect(detectAnomaly(batch([...Array(96).fill("info"), ...Array(4).fill("error")]))).toBeNull();
  });
  it("requires both count and percentage thresholds", () => {
    expect(detectAnomaly(batch([...Array(20).fill("info"), ...Array(5).fill("error")]))).not.toBeNull();
    expect(detectAnomaly(batch([...Array(21).fill("info"), ...Array(5).fill("error")]))).toBeNull();
  });
  it("detects fatal and process failure signals", () => {
    expect(detectAnomaly(batch(["fatal"]))?.severity).toBe("critical");
    const logs = batch(["warn"]); logs.entries[0].message = "Pod OOMKilled";
    expect(detectAnomaly(logs)).not.toBeNull();
  });
  it("rejects batches spanning more than five minutes", () => {
    const logs = batch(["fatal", "info"]);
    logs.entries[1].timestamp = new Date(now + 301000).toISOString();
    expect(() => detectAnomaly(logs)).toThrow(/five minutes/);
  });
});
