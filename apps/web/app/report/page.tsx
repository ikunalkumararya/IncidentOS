"use client";

import Link from "next/link";
import { useState } from "react";
import { Field } from "@/components/auth/Field";
import { Notice, SubmitButton } from "@/components/auth/shared";
import { useValidatedForm } from "@/lib/useValidatedForm";
import { validateDescription, validateReportTitle, validateService } from "@/lib/validation";

/**
 * The public report form.
 *
 * It lives on its own route rather than as a section of the landing page on
 * purpose: `/` is documented as fully static — no server, no API key, no
 * network — and putting a form that posts to an API on it would quietly end
 * that. This page posts to /api/report, a server-side handler that signs the
 * request and forwards it to the intake webhook.
 */
export default function ReportPage() {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const form = useValidatedForm({ title: "", service: "", description: "" }, (v) => ({
    title: validateReportTitle(v.title),
    service: validateService(v.service),
    description: validateDescription(v.description),
  }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.submit()) return;

    setNotice(null);
    setPending(true);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.values),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That report could not be filed.");
      setSent(true);
    } catch (error) {
      // A network failure lands here too, and reads the same to the reporter:
      // we did not take the report.
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "That report could not be filed. Please try again shortly.",
      );
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-8">
      <Link href="/" className="flex items-baseline gap-2 self-start">
        <span className="text-[15px] font-semibold tracking-tight">IncidentOS</span>
        <span className="text-[12px] text-[var(--color-ink-dark-muted)]">Investigate. Fix. Verify.</span>
      </Link>

      <div className="flex flex-1 items-center">
        <div className="w-full py-12">
          {sent ? (
            <div aria-live="polite">
              <h1 className="display text-[2.1rem]">Report received.</h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                It has been queued for analysis, and the findings go to a responder for review before
                anyone acts on them. There is no status page for this — if we need more from you,
                nothing here can reach you, so include everything you can in the report itself.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-card)] px-4 py-2.5 text-[13.5px] font-medium transition hover:bg-[var(--color-canvas-sunk)]"
                >
                  Report something else
                </button>
                <Link
                  href="/"
                  className="rounded-md px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-ink-dark-secondary)] underline-offset-2 transition hover:underline"
                >
                  Back to the site
                </Link>
              </div>
            </div>
          ) : (
            <>
              <h1 className="display text-[2.1rem]">Report an incident.</h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                Tell us what broke. The report is queued for analysis and reviewed by a responder —
                filing this does not page anyone, so use your usual channel if something is on fire.
              </p>

              <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
                {notice && <Notice>{notice}</Notice>}

                <Field
                  label="What happened?"
                  value={form.values.title}
                  onChange={form.set("title")}
                  onBlur={form.blur("title")}
                  error={form.errorFor("title")}
                  placeholder="Checkout fails at the payment step"
                  autoFocus
                />

                <Field
                  label="Affected service"
                  value={form.values.service}
                  onChange={form.set("service")}
                  onBlur={form.blur("service")}
                  error={form.errorFor("service")}
                  placeholder="payments-api"
                  hint={
                    <p className="text-[12.5px] leading-5 text-[var(--color-ink-dark-muted)]">
                      A best guess is fine.
                    </p>
                  }
                />

                <Field
                  label="Details"
                  multiline
                  value={form.values.description}
                  onChange={form.set("description")}
                  onBlur={form.blur("description")}
                  error={form.errorFor("description")}
                  placeholder="When it started, what you were doing, any error text you saw."
                  hint={
                    <p className="text-[12.5px] leading-5 text-[var(--color-ink-dark-muted)]">
                      Timestamps and exact error messages help most.
                    </p>
                  }
                />

                <SubmitButton pending={pending}>
                  {pending ? "Sending…" : "Send report"}
                </SubmitButton>
              </form>
            </>
          )}
        </div>
      </div>

      <p className="text-[12px] text-[var(--color-ink-dark-muted)]">
        Don’t include passwords, tokens or personal data — reports are stored and read by the team.
      </p>
    </main>
  );
}
