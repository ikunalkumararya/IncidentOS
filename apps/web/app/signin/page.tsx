"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/auth/Field";
import { Notice, SubmitButton } from "@/components/auth/shared";
import { AuthError, signIn } from "@/lib/auth";
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.submit()) return;

    setNotice(null);
    setPending(true);
    try {
      await signIn(form.values.email, form.values.password);
      // Read straight off the URL rather than useSearchParams, which would
      // need a Suspense boundary here for no benefit. Only same-site paths
      // are honoured, so ?next= cannot be used as an open redirect.
      const requested = new URLSearchParams(window.location.search).get("next");
      const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/console";
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

        <p className="text-center text-[12.5px] text-[var(--color-ink-dark-muted)]">
          Demo account: <span className="font-mono">demo@incidentos.dev</span> /{" "}
          <span className="font-mono">incident123</span>
        </p>
      </form>
    </AuthShell>
  );
}
