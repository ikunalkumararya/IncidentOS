import Link from "next/link";

/**
 * Two-column frame for the auth pages: the form on the ivory canvas, and a
 * quiet dark panel carrying the product's actual proof. The panel is static —
 * a looping animation next to a form competes with the thing you came to do.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      {/* ------------------------------ form ------------------------------ */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex items-baseline gap-2 self-start">
          <span className="text-[15px] font-semibold tracking-tight">IncidentOS</span>
          <span className="text-[12px] text-[var(--color-ink-dark-muted)]">
            Investigate. Fix. Verify.
          </span>
        </Link>

        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-12">
            <h1 className="display text-[2.1rem]">{title}</h1>
            <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
              {subtitle}
            </p>

            <div className="mt-8">{children}</div>

            <p className="mt-7 text-[13.5px] text-[var(--color-ink-dark-secondary)]">{footer}</p>
          </div>
        </div>

        <p className="text-[12px] text-[var(--color-ink-dark-muted)]">
          A hackathon demo. No account is created and nothing you type is sent anywhere.
        </p>
      </div>

      {/* ------------------------------ proof ----------------------------- */}
      <aside className="dark-panel relative hidden flex-col justify-between p-12 lg:flex">
        <div>
          <p className="panel-title">Incident #4821 · payments-api · SEV-1</p>
          <p className="display mt-5 text-[1.85rem] leading-tight text-[var(--color-ink)]">
            It isn’t told what broke.
            <br />
            <span className="text-[var(--color-ink-muted)]">It finds out.</span>
          </p>

          <div className="mt-8 border-l-2 pl-4" style={{ borderColor: "var(--color-status-good)" }}>
            <p className="panel-title">Root cause · 94% confidence</p>
            <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--color-ink-secondary)]">
              v1.8.4 queues the inbound request instead of a transaction summary, retaining the 4 KiB
              raw payload per capture until the container reaches its 2Gi limit and is OOM-killed.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2 font-mono text-[12px]">
            {[
              ["get_metrics", "peak 39% → 92%"],
              ["get_deployment_history", "v1.8.4 degraded"],
              ["read_file", "src/transactions.ts"],
              ["apply_patch", "1 file changed"],
              ["run_tests", "47/47 passed"],
            ].map(([tool, result]) => (
              <div key={tool} className="flex min-w-0 items-baseline gap-2">
                <span
                  aria-hidden
                  className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--color-status-good)" }}
                />
                <span className="truncate text-[var(--color-ink)]">{tool}</span>
                <span className="ml-auto shrink-0 pl-3 text-[var(--color-ink-muted)]">{result}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--color-hairline)] pt-5">
            <dl className="grid grid-cols-2 gap-5">
              {[
                ["Tests", "46/47 → 47/47"],
                ["Retained memory", "112.46 → 3.55 MB"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="panel-title">{label}</dt>
                  <dd className="mt-1.5 font-mono text-[13px] tabular text-[var(--color-ink)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Measured by running the code, once on the defect and once on the patch the agent wrote.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
