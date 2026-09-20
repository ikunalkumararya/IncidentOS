import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const reportSchema = z.object({
  eventId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(3).max(200),
  service: z.string().trim().min(1).max(100),
  description: z.string().trim().min(10).max(12000),
  severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
});
export const logSchema = z.object({
  eventId: z.string().trim().min(1).max(120),
  service: z.string().trim().min(1).max(100),
  entries: z.array(z.object({
    timestamp: z.iso.datetime({ offset: true }),
    level: z.enum(["debug", "info", "warn", "error", "fatal"]),
    message: z.string().min(1).max(2000),
  })).min(1).max(200),
});
export type LogBatch = z.infer<typeof logSchema>;

/** Sign the exact request bytes, with a five-minute replay window. */
export function validSignature(raw: Buffer, timestamp: string, signature: string, secret: string, now = Date.now()): boolean {
  if (!secret || !/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamp + ".").update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

/** Each submitted batch is a monitoring window, not an arbitrary sample. */
export function detectAnomaly(batch: LogBatch) {
  const times = batch.entries.map(e => Date.parse(e.timestamp));
  if (Math.max(...times) - Math.min(...times) > 300_000) throw new Error("Log batches must cover at most five minutes");
  const errors = batch.entries.filter(e => e.level === "error" || e.level === "fatal");
  const fatal = batch.entries.some(e => e.level === "fatal");
  const crashes = batch.entries.filter(e => /out of memory|oomkilled|crashloopbackoff/i.test(e.message));
  const rate = errors.length / batch.entries.length;
  if (!fatal && crashes.length === 0 && !(errors.length >= 5 && rate >= 0.2)) return null;
  return {
    title: `${batch.service}: ${fatal ? "fatal log detected" : crashes.length ? "process or memory failure" : "elevated error rate"}`,
    severity: fatal ? "critical" : "high",
    description: `${errors.length}/${batch.entries.length} entries are errors (${Math.round(rate * 100)}%). ${crashes.length} crash/memory signals.`,
  };
}
