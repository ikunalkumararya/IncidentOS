"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/auth/Field";
import { Notice, SubmitButton } from "@/components/auth/shared";
import { AuthError, DEMO_CREDENTIALS, signIn } from "@/lib/auth";
import { useValidatedForm } from "@/lib/useValidatedForm";
import { validateEmail, validatePassword } from "@/lib/validation";

export default function SignInPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const form = useValidatedForm({ email: "", password: "" }, (v) => ({
    email: validateEmail(v.email),
    password: validatePassword(v.password),
  }));

  /** Shared by the form and the demo button, so both land the same way. */
  async function authenticate(email: string, password: string) {
    setNotice(null);
    setPending(true);
    try {
      await signIn(email, password);
      // Read straight off the URL rather than useSearchParams, which would
      // need a Suspense boundary here for no benefit. Only same-site paths
      // are honoured, so ?next= cannot be used as an open redirect.
      const requested = new URLSearchParams(window.location.search).get("next");
      const destination = requested && /^\/(dashboard|console)(\/|\?|$)/.test(requested) && !requested.includes("\\") ? requested : "/dashboard/incident-analysis";
      // The session cookie is set by the response, so the console is reachable
      // from here. refresh() re-runs middleware, which would otherwise bounce
      // us straight back on a cached routing decision.
      router.replace(destination);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof AuthError ? error.message : "Something went wrong. Please try again.";
      setNotice(message);
      setPending(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.submit()) return;
    await authenticate(form.values.email, form.values.password);
  }

  /**
   * Fills the fields and signs in, so the credentials are visible rather than
   * happening invisibly — someone watching the demo should see what was used.
   *
   * The constants are passed to authenticate directly rather than read back
   * from form.values, which is still the previous render's state at this
   * point.
   */
  async function onUseDemoAccount() {
    form.set("email")(DEMO_CREDENTIALS.email);
    form.set("password")(DEMO_CREDENTIALS.password);
    await authenticate(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
  }

  return (
    <AuthShell
      title="Welcome back."
      subtitle="Sign in to open the incident console."
      footer={
        <>
          Don’t have an account?{" "}
          <Link href="/signup" className="font-medium underline underline-offset-2">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notice && <Notice>{notice}</Notice>}

        <Field
          label="Email"
          type="email"
          value={form.values.email}
          onChange={form.set("email")}
          onBlur={form.blur("email")}
          error={form.errorFor("email")}
          autoComplete="email"
          placeholder="you@company.com"
          autoFocus
        />

        <div>
          <Field
            label="Password"
            type="password"
            value={form.values.password}
            onChange={form.set("password")}
            onBlur={form.blur("password")}
            error={form.errorFor("password")}
            autoComplete="current-password"
            placeholder="••••••••"
            revealable
          />
          <div className="text-right">
            <button
              type="button"
              onClick={() => setNotice("Password reset isn’t wired up in the demo.")}
              className="text-[12.5px] text-[var(--color-ink-dark-secondary)] underline-offset-2 transition hover:text-[var(--color-ink-dark)] hover:underline"
            >
              Forgot your password?
            </button>
          </div>
        </div>

        <SubmitButton pending={pending}>{pending ? "Signing in…" : "Sign in"}</SubmitButton>

        <div className="space-y-2 rounded-md border border-dashed border-[var(--color-rule-strong)] p-3">
          <button
            type="button"
            onClick={onUseDemoAccount}
            disabled={pending}
            className="w-full rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-card)] px-4 py-2 text-[13.5px] font-medium transition hover:bg-[var(--color-canvas-sunk)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Use the demo account
          </button>
          <p className="text-center text-[12px] text-[var(--color-ink-dark-muted)]">
            <span className="font-mono">{DEMO_CREDENTIALS.email}</span> /{" "}
            <span className="font-mono">{DEMO_CREDENTIALS.password}</span>
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
