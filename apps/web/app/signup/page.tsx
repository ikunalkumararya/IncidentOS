"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/auth/Field";
import { Notice, SubmitButton } from "@/components/auth/shared";
import { AuthError, signUp } from "@/lib/auth";
import { useValidatedForm } from "@/lib/useValidatedForm";
import { scorePassword, validateEmail, validateName, validatePassword } from "@/lib/validation";

export default function SignUpPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const form = useValidatedForm({ name: "", email: "", password: "" }, (v) => ({
    name: validateName(v.name),
    email: validateEmail(v.email),
    password: validatePassword(v.password),
  }));

  const strength = scorePassword(form.values.password);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.submit()) return;

    setNotice(null);
    setPending(true);
    try {
      // The account is created and signed in by the same response, so there
      // is no second trip through the sign-in form.
      await signUp(form.values.name, form.values.email, form.values.password);
      router.replace("/console");
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
      title="Create your account."
      subtitle="Then hand Claude a production incident and watch it work."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/signin" className="font-medium underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notice && <Notice>{notice}</Notice>}

        <Field
          label="Name"
          value={form.values.name}
          onChange={form.set("name")}
          onBlur={form.blur("name")}
          error={form.errorFor("name")}
          autoComplete="name"
          placeholder="Ada Lovelace"
          autoFocus
        />

        <Field
          label="Work email"
          type="email"
          value={form.values.email}
          onChange={form.set("email")}
          onBlur={form.blur("email")}
          error={form.errorFor("email")}
          autoComplete="email"
          placeholder="you@company.com"
        />

        <Field
          label="Password"
          type="password"
          value={form.values.password}
          onChange={form.set("password")}
          onBlur={form.blur("password")}
          error={form.errorFor("password")}
          autoComplete="new-password"
          placeholder="••••••••"
          revealable
          hint={
            <div className="flex w-full items-center gap-2.5">
              <div className="flex flex-1 gap-1.5" aria-hidden>
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className="h-[3px] flex-1 rounded-full transition-colors duration-300"
                    style={{
                      background:
                        strength.score >= step
                          ? strength.score === 1
                            ? "var(--color-status-warning)"
                            : strength.score === 2
                              ? "var(--color-clay)"
                              : "var(--color-status-good)"
                          : "var(--color-rule)",
                    }}
                  />
                ))}
              </div>
              <span className="shrink-0 text-[12.5px] leading-5 text-[var(--color-ink-dark-muted)]">
                {strength.label}
              </span>
            </div>
          }
        />

        <SubmitButton pending={pending}>
          {pending ? "Creating account…" : "Create account"}
        </SubmitButton>

        <p className="text-[12px] leading-relaxed text-[var(--color-ink-dark-muted)]">
          By continuing you agree to the Terms of Service and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
}
