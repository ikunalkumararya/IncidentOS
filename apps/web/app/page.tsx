import Link from "next/link";
import { DemoReplay } from "@/components/landing/DemoReplay";
import { Reveal } from "@/components/landing/Reveal";

const STEPS = [
  {
    n: "01",
    title: "Investigate",
    body: "It starts with nothing but the incident card. It pulls metrics, logs, Kubernetes events and deployment history, and builds a timeline of what actually happened — correlating across sources, because one signal is a coincidence.",
    tools: ["get_metrics", "search_logs", "get_kubernetes_events", "get_deployment_history"],
  },
  {
    n: "02",
    title: "Prove",
    body: "It proposes competing explanations — including ones it expects to be wrong — and then tries to disprove each. Traffic rose only 8%. The connection pool never queued. Every finding cites the tool result it came from.",
    tools: ["report_hypothesis", "report_evidence", "search_code", "read_file"],
  },
  {
    n: "03",
    title: "Fix and verify",
    body: "Once the cause is proven it patches the source, type-checks it, runs the suite, and re-measures memory. If a test fails it reads the output and iterates. The numbers are measured, not asserted.",
    tools: ["report_root_cause", "apply_patch", "run_tests"],
  },
];

const RULES = [
  ["Competing hypotheses", "At least two recorded before any conclusion is accepted."],
  ["Cited evidence", "Two supporting findings minimum, each naming the tool result behind it."],
  ["Elimination", "Every hypothesis examined — including the ones being ruled out."],
  ["Causality", "No patch can be applied before a root cause is proven."],
];

const PROOF = [
  {
    label: "Test suite",
    before: "46 / 47",
    after: "47 / 47",
    note: "A regression test that fails while the defect is present, and passes after the patch.",
  },
  {
    label: "Retained memory",
    before: "112.46 MB",
    after: "3.55 MB",
    note: "Measured over 25,000 real captures — heap plus external, which is what the cgroup counts.",
  },
  {
    label: "Per transaction",
    before: "4,717 B",
    after: "149 B",
    note: "The whole request was being retained where an 80-byte summary would do.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ------------------------------------------------------------ */}
      {/* nav                                                           */}
      {/* ------------------------------------------------------------ */}
      <header className="sticky top-0 z-20 border-b border-[var(--color-rule)] bg-[var(--color-canvas)]/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight">IncidentOS</span>
            <span className="hidden text-[12px] text-[var(--color-ink-dark-muted)] sm:block">
              Investigate. Fix. Verify.
            </span>
          </Link>

          <div className="flex items-center gap-6">
            <a
              href="#how"
              className="hidden text-[13px] text-[var(--color-ink-dark-secondary)] transition hover:text-[var(--color-ink-dark)] sm:block"
            >
              How it works
            </a>
            <a
              href="#proof"
              className="hidden text-[13px] text-[var(--color-ink-dark-secondary)] transition hover:text-[var(--color-ink-dark)] sm:block"
            >
              Verification
            </a>
            <Link
              href="/signup"
              className="rounded-md bg-[var(--color-ink-dark)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-canvas)] transition hover:opacity-85"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ---------------------------------------------------------- */}
        {/* hero                                                        */}
        {/* ---------------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-6 pb-10 pt-14 sm:pt-20">
          <Reveal>
            <p className="eyebrow">Autonomous incident investigation</p>
          </Reveal>

          <Reveal delay={70}>
            <h1 className="display mt-5 max-w-3xl text-[2.5rem] sm:text-[3.7rem]">
              It isn&rsquo;t told what broke.
              <br />
              <span className="text-[var(--color-clay-deep)]">It finds out.</span>
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
              IncidentOS hands Claude a production incident — real telemetry, a real repository, a real
              defect — and no answer. It builds competing hypotheses, disproves all but one, patches the
              code, and verifies the fix against a real measurement.
            </p>
          </Reveal>

          <Reveal delay={210}>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="rounded-md bg-[var(--color-ink-dark)] px-5 py-2.5 text-[14px] font-medium text-[var(--color-canvas)] transition hover:opacity-85"
              >
                Get started
              </Link>            </div>
          </Reveal>

          <Reveal delay={280}>
            <p className="mt-5 font-mono text-[12px] text-[var(--color-ink-dark-muted)]">
              Claude Opus 5 · 11 tools · deterministic incident data · no Kubernetes required
            </p>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* the animated replay                                         */}
        {/* ---------------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-6 pb-24">
          <Reveal>
            <DemoReplay />
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-3 text-center text-[12.5px] text-[var(--color-ink-dark-muted)]">
              A replay of an actual investigation. Every number in it is one the real run produces.
            </p>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* the claim                                                   */}
        {/* ---------------------------------------------------------- */}
        <section className="border-y border-[var(--color-rule)] bg-[var(--color-canvas-sunk)]">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <Reveal>
              <p className="display max-w-3xl text-[1.65rem] leading-snug sm:text-[2.1rem]">
                Ask an AI what might be wrong and it will tell you something plausible.
                <span className="text-[var(--color-ink-dark-muted)]">
                  {" "}
                  Plausible is not the same as true.
                </span>
              </p>
            </Reveal>
            <Reveal delay={90}>
              <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                So the investigation is structured so that a conclusion has to be earned. The agent
                records its findings through tools that refuse to accept a shortcut — and the
                measurements that verify the fix are taken by the server, not by the model that wrote
                it.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* how it works                                                */}
        {/* ---------------------------------------------------------- */}
        <section id="how" className="mx-auto max-w-5xl scroll-mt-16 px-6 py-24">
          <Reveal>
            <p className="eyebrow">How it works</p>
            <h2 className="display mt-4 text-[2.1rem] sm:text-[2.6rem]">Three phases, one thread.</h2>
            <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
              The agent keeps everything it has learned across all three, so the engineer writing the
              fix is the same one who proved the cause.
            </p>
          </Reveal>

          <div className="mt-14 space-y-px">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 90}>
                <div className="grid gap-5 border-t border-[var(--color-rule)] py-9 sm:grid-cols-[5rem_1fr]">
                  <span className="font-mono text-[13px] text-[var(--color-clay)]">{step.n}</span>
                  <div>
                    <h3 className="display text-[1.5rem]">{step.title}</h3>
                    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                      {step.body}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {step.tools.map((tool) => (
                        <code
                          key={tool}
                          className="rounded border border-[var(--color-rule)] bg-[var(--color-card)] px-2 py-1 font-mono text-[11.5px] text-[var(--color-ink-dark-secondary)]"
                        >
                          {tool}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* what it must prove                                          */}
        {/* ---------------------------------------------------------- */}
        <section className="border-y border-[var(--color-rule)] bg-[var(--color-canvas-sunk)]">
          <div className="mx-auto max-w-5xl px-6 py-24">
            <Reveal>
              <p className="eyebrow">Rigour, enforced</p>
              <h2 className="display mt-4 max-w-2xl text-[2.1rem] sm:text-[2.6rem]">
                Rules the agent cannot talk its way around.
              </h2>
              <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                Prompts ask. These refuse. Each rule lives inside the tool that records the finding, so
                skipping a step returns an error the agent has to correct — not a timeline with holes
                in it.
              </p>
            </Reveal>

            <Reveal delay={90}>
              <dl className="mt-12 overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-card)]">
                {RULES.map(([term, description], i) => (
                  <div
                    key={term}
                    className={`grid gap-2 px-5 py-5 sm:grid-cols-[13rem_1fr] ${
                      i > 0 ? "border-t border-[var(--color-rule)]" : ""
                    }`}
                  >
                    <dt className="text-[14px] font-medium">{term}</dt>
                    <dd className="text-[14px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* proof                                                       */}
        {/* ---------------------------------------------------------- */}
        <section id="proof" className="mx-auto max-w-5xl scroll-mt-16 px-6 py-24">
          <Reveal>
            <p className="eyebrow">Verification</p>
            <h2 className="display mt-4 max-w-2xl text-[2.1rem] sm:text-[2.6rem]">
              Every number here was measured.
            </h2>
            <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
              The demo repository contains a real memory leak and a real test that catches it. The
              before and after figures come from running that code — once on the defect, once on the
              patch the agent wrote.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-3">
            {PROOF.map((item, i) => (
              <Reveal key={item.label} delay={i * 90} className="bg-[var(--color-card)]">
                <div className="h-full p-6">
                  <p className="eyebrow">{item.label}</p>
                  <div className="mt-4 flex items-baseline gap-2.5">
                    <span className="font-mono text-[15px] text-[var(--color-ink-dark-muted)] line-through tabular">
                      {item.before}
                    </span>
                    <span className="text-[var(--color-ink-dark-muted)]">→</span>
                  </div>
                  <p className="display mt-1 text-[2rem] tabular">{item.after}</p>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                    {item.note}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200}>
            <p className="mt-8 max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-ink-dark-muted)]">
              A note on that memory figure: the retained payloads are typed-array backing stores, which
              live outside the V8 heap. Measuring <code className="font-mono">heapUsed</code> alone
              reports a comfortable 14 MB for a process that is about to be OOM-killed — the same trap
              the incident itself is about.
            </p>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* final CTA                                                   */}
        {/* ---------------------------------------------------------- */}
        <section className="border-t border-[var(--color-rule)] bg-[var(--color-canvas-sunk)]">
          <div className="mx-auto max-w-5xl px-6 py-24 text-center">
            <Reveal>
              <h2 className="display mx-auto max-w-2xl text-[2.2rem] sm:text-[2.9rem]">
                Give it an incident.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-[var(--color-ink-dark-secondary)]">
                One click, about ninety seconds, and you can watch every tool call it makes on the way
                to the answer.
              </p>
            </Reveal>
            <Reveal delay={90}>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/signup"
                  className="rounded-md bg-[var(--color-ink-dark)] px-6 py-3 text-[14px] font-medium text-[var(--color-canvas)] transition hover:opacity-85"
                >
                  Get started
                </Link>                <code className="rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-card)] px-4 py-3 font-mono text-[13px] text-[var(--color-ink-dark-secondary)]">
                  pnpm investigate
                </code>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* footer                                                      */}
        {/* ---------------------------------------------------------- */}
        <footer className="border-t border-[var(--color-rule)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
            <div>
              <p className="text-[14px] font-semibold tracking-tight">IncidentOS</p>
              <p className="mt-1 text-[12.5px] text-[var(--color-ink-dark-muted)]">
                From alert to verified fix.
              </p>
            </div>
            <div className="flex items-center gap-6 text-[13px] text-[var(--color-ink-dark-secondary)]">
              <a href="#how" className="transition hover:text-[var(--color-ink-dark)]">
                How it works
              </a>
              <a href="#proof" className="transition hover:text-[var(--color-ink-dark)]">
                Verification
              </a>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
