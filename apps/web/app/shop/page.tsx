"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Field } from "@/components/auth/Field";
import { Notice, SubmitButton } from "@/components/auth/shared";
import { formatPrice, PRODUCTS } from "@/lib/shop";

/**
 * A demo storefront that fails at the payment step on purpose.
 *
 * The point is the hand-off: a customer hits a real-looking failure, reports
 * it in their own words, and that report travels through the same signed
 * intake as everything else (/api/report) until it shows up on the dashboard
 * and gets investigated. The failure is simulated here in the browser —
 * nothing is charged and no payment provider is contacted — but the report it
 * produces is a real one.
 *
 * The technical context (reference, timestamp, error code, basket) is attached
 * automatically, because that is the part a customer cannot be expected to
 * supply and the part the investigation actually needs.
 */

/** Long enough to read as a real attempt, short enough to demo. */
const PAYMENT_DELAY_MS = 2200;
const ERROR_CODE = "ERR_CAPTURE_TIMEOUT";
const ERROR_TEXT = "the payment gateway did not respond within 30s";

type Stage = "browsing" | "paying" | "failed";

interface Failure {
  reference: string;
  at: string;
}

export default function ShopPage() {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<Stage>("browsing");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logSending, setLogSending] = useState(false);
  const [logStatus, setLogStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const lines = useMemo(
    () =>
      PRODUCTS.filter((p) => cart[p.id]).map((p) => ({ product: p, quantity: cart[p.id] })),
    [cart],
  );
  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const total = lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);

  const add = (id: string) => {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    // A new basket invalidates the previous failure; reporting it afterwards
    // would attach the wrong items to the report.
    setStage("browsing");
    setFailure(null);
    setReporting(false);
    setSent(false);
  };

  const remove = (id: string) =>
    setCart((c) => {
      const next = { ...c };
      if ((next[id] ?? 0) <= 1) delete next[id];
      else next[id] -= 1;
      return next;
    });

  async function pay() {
    setStage("paying");
    setError(null);
    await new Promise((resolve) => setTimeout(resolve, PAYMENT_DELAY_MS));
    setFailure({
      reference: `ORD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      at: new Date().toISOString(),
    });
    setStage("failed");
  }

  /**
   * The other way in: a log collector noticing trouble on its own, with no
   * customer involved. The batch is written server-side and the detector
   * decides whether it warrants an incident, so this button cannot manufacture
   * one — it can only send the sample.
   */
  async function sendLogs() {
    setLogSending(true);
    setLogStatus(null);
    try {
      const response = await fetch("/api/logs", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send the log batch.");
      setLogStatus({
        ok: true,
        text: body.detected
          ? `${body.entries} log lines from ${body.service} delivered. The detector raised an incident — it is being investigated now.`
          : `${body.entries} log lines from ${body.service} delivered. The detector found nothing worth raising.`,
      });
    } catch (e) {
      setLogStatus({ ok: false, text: e instanceof Error ? e.message : "Could not send the log batch." });
    } finally {
      setLogSending(false);
    }
  }

  /**
   * Everything the responder needs and the customer should not have to type.
   * The customer's own words go last, under a heading, so the two are never
   * confused with each other.
   */
  function buildDescription(): string {
    const context = failure
      ? [
          "Payment failed at the final checkout step of the demo storefront.",
          "",
          `Order reference: ${failure.reference}`,
          `Failed at: ${failure.at}`,
          `Error shown to the customer: ${ERROR_CODE} — ${ERROR_TEXT}`,
          `Basket: ${itemCount} item${itemCount === 1 ? "" : "s"}, total ${formatPrice(total)}`,
          `Items: ${lines.map((l) => `${l.product.name} ×${l.quantity}`).join("; ") || "none"}`,
          "Page: /shop",
        ]
      : [
          "A problem was reported from the demo storefront.",
          "",
          `Basket at the time: ${itemCount} item${itemCount === 1 ? "" : "s"}, total ${formatPrice(total)}`,
          "Page: /shop",
        ];

    return [...context, "", "What the customer said:", note.trim() || "(nothing added)"].join("\n");
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: failure
            ? `Checkout failed at payment (${failure.reference})`
            : "Problem reported from the storefront",
          // The failure is at capture, so the report is filed against the
          // service that owns it rather than the page the customer was on.
          service: "payments-api",
          description: buildDescription(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That report could not be filed.");
      setSent(true);
      setReporting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That report could not be filed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-rule)] pb-5">
        <div>
          <p className="text-[15px] font-semibold tracking-tight">Northwind Supply</p>
          <p className="text-[12px] text-[var(--color-ink-dark-muted)]">
            A demo storefront in front of IncidentOS
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={sendLogs}
            disabled={logSending}
            className="flex items-center gap-2 rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-card)] px-3 py-1.5 text-[12.5px] font-medium transition hover:bg-[var(--color-canvas-sunk)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logSending && (
              <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {logSending ? "Sending logs…" : "Simulate a log spike"}
          </button>
          <button
            type="button"
            onClick={() => { setReporting(true); setSent(false); }}
            className="text-[13px] text-[var(--color-ink-dark-secondary)] underline-offset-2 hover:underline"
          >
            Report a problem
          </button>
          <Link href="/" className="text-[13px] text-[var(--color-ink-dark-secondary)] underline-offset-2 hover:underline">
            About IncidentOS
          </Link>
        </div>
      </header>

      {logStatus && (
        <p
          role="status"
          className="mt-4 rounded-md border px-3 py-2.5 text-[13px]"
          style={{
            borderColor: logStatus.ok
              ? "color-mix(in srgb, var(--color-status-good) 35%, transparent)"
              : "color-mix(in srgb, var(--color-status-critical) 35%, transparent)",
            background: logStatus.ok
              ? "color-mix(in srgb, var(--color-status-good) 7%, transparent)"
              : "color-mix(in srgb, var(--color-status-critical) 7%, transparent)",
          }}
        >
          {logStatus.text}
        </p>
      )}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ------------------------------ catalogue ------------------------------ */}
        <section aria-label="Products">
          <h1 className="display text-[1.9rem]">Desk & workshop</h1>
          <p className="mt-2 text-[14px] text-[var(--color-ink-dark-secondary)]">
            Ten things. Add a couple to the basket and try to pay.
          </p>

          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {PRODUCTS.map((product) => (
              <li
                key={product.id}
                className="flex gap-4 rounded-lg border border-[var(--color-rule)] bg-[var(--color-card)] p-4"
              >
                <span
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-[var(--color-canvas-sunk)] font-mono text-[13px] text-[var(--color-ink-dark-secondary)]"
                >
                  {product.mark}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium">{product.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-dark-muted)]">{product.blurb}</p>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <span className="font-mono text-[13px] tabular">{formatPrice(product.priceCents)}</span>
                    <button
                      type="button"
                      onClick={() => add(product.id)}
                      className="rounded-md border border-[var(--color-rule-strong)] px-3 py-1.5 text-[12.5px] font-medium transition hover:bg-[var(--color-canvas-sunk)]"
                    >
                      Add{cart[product.id] ? ` (${cart[product.id]})` : ""}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* -------------------------------- basket -------------------------------- */}
        <aside className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-card)] p-5 lg:sticky lg:top-8">
          <h2 className="text-[15px] font-semibold">Basket</h2>

          {!lines.length ? (
            <p className="mt-3 text-[13px] text-[var(--color-ink-dark-muted)]">Nothing in the basket yet.</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {lines.map(({ product, quantity }) => (
                  <li key={product.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">
                      {product.name} <span className="text-[var(--color-ink-dark-muted)]">×{quantity}</span>
                    </span>
                    <span className="font-mono tabular">{formatPrice(product.priceCents * quantity)}</span>
                    <button
                      type="button"
                      onClick={() => remove(product.id)}
                      aria-label={`Remove one ${product.name}`}
                      className="text-[var(--color-ink-dark-muted)] transition hover:text-[var(--color-ink-dark)]"
                    >
                      −
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-rule)] pt-3">
                <span className="text-[13px] font-medium">Total</span>
                <span className="font-mono text-[14px] tabular">{formatPrice(total)}</span>
              </div>

              <button
                type="button"
                onClick={pay}
                disabled={stage === "paying"}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-ink-dark)] px-4 py-2.5 text-[14px] font-medium text-[var(--color-canvas)] transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stage === "paying" && (
                  <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {stage === "paying" ? "Taking payment…" : "Pay now"}
              </button>
              <p className="mt-2 text-center text-[11.5px] text-[var(--color-ink-dark-muted)]">
                Nothing is charged. This checkout fails on purpose.
              </p>
            </>
          )}

          {/* ------------------------------ failure ------------------------------ */}
          {stage === "failed" && failure && (
            <div
              role="alert"
              className="mt-4 rounded-md border p-3"
              style={{
                borderColor: "color-mix(in srgb, var(--color-status-critical) 35%, transparent)",
                background: "color-mix(in srgb, var(--color-status-critical) 7%, transparent)",
              }}
            >
              <p className="text-[13px] font-medium" style={{ color: "var(--color-status-critical)" }}>
                Payment failed
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                We couldn’t take your payment — {ERROR_TEXT}. Nothing has been charged.
              </p>
              <p className="mt-2 font-mono text-[11.5px] text-[var(--color-ink-dark-muted)]">
                {ERROR_CODE} · {failure.reference}
              </p>
              {!reporting && !sent && (
                <button
                  type="button"
                  onClick={() => setReporting(true)}
                  className="mt-3 w-full rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-card)] px-3 py-2 text-[13px] font-medium transition hover:bg-[var(--color-canvas-sunk)]"
                >
                  Report this problem
                </button>
              )}
            </div>
          )}

          {sent && (
            <div className="mt-4 rounded-md border border-[var(--color-rule)] bg-[var(--color-canvas-sunk)] p-3">
              <p className="text-[13px] font-medium">Thanks — that’s been reported.</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                It is queued for analysis now. A responder reviews the findings before anyone acts on
                them.
              </p>
            </div>
          )}

          {/* ------------------------------- report ------------------------------- */}
          {reporting && (
            <form onSubmit={submitReport} noValidate className="mt-4 space-y-3 border-t border-[var(--color-rule)] pt-4">
              <div>
                <p className="text-[13px] font-medium">Tell us what happened</p>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-dark-muted)]">
                  {failure
                    ? "The reference, error code and your basket are attached automatically."
                    : "Your basket is attached automatically."}
                </p>
              </div>

              {error && <Notice>{error}</Notice>}

              <Field
                label="In your own words"
                multiline
                rows={4}
                value={note}
                onChange={setNote}
                placeholder="I tried to pay twice and it timed out both times."
              />

              <SubmitButton pending={sending}>{sending ? "Sending…" : "Send report"}</SubmitButton>
              <button
                type="button"
                onClick={() => setReporting(false)}
                className="w-full text-[12.5px] text-[var(--color-ink-dark-secondary)] underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            </form>
          )}
        </aside>
      </div>
    </main>
  );
}
