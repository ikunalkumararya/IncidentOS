"use client";

import { useEffect, useRef, useState } from "react";
import DemoIncidentAnalysis from "@/components/DemoIncidentAnalysis";
import { IncidentPhases, type PhasePlanItem, type PhaseRow } from "@/components/IncidentPhases";
import { Report } from "@/components/panels";
import { API_BASE } from "@/lib/useInvestigation";

type Incident = {
  id: string; title: string; service: string; severity: string; source: string;
  status: string; created_at: string; description?: string; report?: string; error?: string;
  evidence?: { timestamp: string; level: string; message: string }[];
  phases?: PhaseRow[]; phasePlan?: PhasePlanItem[]; phases_done?: number;
};
const statusLabels: Record<string, string> = { queued: "Queued", investigating: "Investigating", review: "Needs review", failed: "Failed" };
const sourceLabels: Record<string, string> = { website: "Website report", monitoring: "Log detection", manual: "Team report" };
const field = "w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-2 focus:outline-[var(--color-clay-deep)]";
const button = "min-h-10 rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-surface)] disabled:opacity-50";

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}/api/incidents${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to load incidents");
  return body;
}

export default function IncidentAnalysisPage() {
  const [demo, setDemo] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Incident | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deletedIds = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const body = await request("");
        if (!cancelled) { setIncidents(body.incidents.filter((incident: Incident) => !deletedIds.current.has(incident.id))); setError(""); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load incidents"); }
      finally { if (!cancelled) { setLoading(false); timer = setTimeout(refresh, 4000); } }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [demo, version]);

  useEffect(() => {
    setDetail(null); setDetailError(""); setDeleteError("");
    if (!selected || demo) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const body = await request(`/${selected}`);
        if (!cancelled) { setDetail(body); setDetailError(""); }
      } catch (e) { if (!cancelled) setDetailError(e instanceof Error ? e.message : "Unable to load incident"); }
      finally { if (!cancelled) timer = setTimeout(refresh, 3000); }
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selected, demo, version]);

  async function deleteIncident(incident: Incident) {

    if (!window.confirm(`Delete “${incident.title}”? This permanently removes the incident and its investigation history.`)) return;
    const id = incident.id;
    setDeleting(true); setDeleteError("");
    try {
      await request(`/${id}`, { method: "DELETE" });
      deletedIds.current.add(id);
      setIncidents(items => items.filter(item => item.id !== id));
      setSelected(current => current === id ? null : current);
      setVersion(v => v + 1);
    } catch (e) { setDeleteError(e instanceof Error ? e.message : "Unable to delete incident"); }
    finally { setDeleting(false); }

  }

  return <>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-3xl">Incident analysis</h1><p className="mt-2 text-sm text-[var(--color-ink-muted)]">Website reports and log detections, investigated in one place.</p></div>
      <div className="flex gap-2">
        <button className="rounded-lg border border-[var(--color-hairline)] px-4 py-2 text-sm" onClick={() => setDemo(!demo)}>{demo ? "Back to incidents" : "View demo"}</button>
        {!demo && <button className={button} onClick={() => { setCreating(!creating); setFormError(""); }}>{creating ? "Cancel" : "Report incident"}</button>}
      </div>
    </header>
    {demo ? <DemoIncidentAnalysis /> : <>
      {creating && <form className="panel mb-6 space-y-4 p-5" onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        // Retain the key on failures so a retry cannot create a second incident.
        const eventId = form.dataset.eventId ?? crypto.randomUUID();
        form.dataset.eventId = eventId;
        setSaving(true); setFormError("");
        try {
          const body = await request("", { method: "POST", body: JSON.stringify({ eventId, title: data.get("title"), service: data.get("service"), severity: data.get("severity"), description: data.get("description") }) });
          setSelected(body.incident.id); setCreating(false); setVersion(v => v + 1);
        } catch (e) { setFormError(e instanceof Error ? e.message : "Unable to create incident"); }
        finally { setSaving(false); }
      }}>
        <h2 className="text-xl">Report an incident</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm">Title<input className={field} name="title" required minLength={3} maxLength={200} placeholder="Checkout requests are failing" /></label>
          <label className="space-y-1 text-sm">Service<input className={field} name="service" required maxLength={100} placeholder="payments-api" /></label>
          <label className="space-y-1 text-sm">Severity<select className={field} name="severity" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        </div>
        <label className="block space-y-1 text-sm">What happened?<textarea className={field} name="description" required minLength={10} maxLength={12000} rows={3} placeholder="Describe the symptoms, affected users, and when the issue started." /></label>
        <p className="text-xs text-[var(--color-ink-muted)]">Submitting starts an investigation. Findings require review before taking action.</p>
        {formError && <p role="alert" className="text-sm text-[var(--color-status-critical)]">{formError}</p>}
        <button disabled={saving} className={button}>{saving ? "Submitting…" : "Create and investigate"}</button>
      </form>}
      {error && <p role="alert" className="mb-4 text-sm text-[var(--color-status-critical)]">{error}</p>}
      {deleteError && <p role="alert" className="mb-3 text-sm text-[var(--color-status-critical)]">{deleteError}</p>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
        <section className="panel p-4" aria-label="Incidents">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl">Incoming incidents</h2><span className="text-xs text-[var(--color-ink-muted)]">Latest {incidents.length}</span></div>
          {loading ? <p className="text-sm">Loading incidents…</p> : !incidents.length ? <div className="py-8 text-center"><p className="font-medium">No incidents yet</p><p className="mt-2 text-sm text-[var(--color-ink-muted)]">Report an issue or connect your website and log collector to start.</p></div> : <ul className="space-y-2">{incidents.map(incident => <li key={incident.id} className="relative">
            <button onClick={() => setSelected(incident.id)} aria-pressed={selected === incident.id} className={`w-full rounded-xl border p-4 text-left transition ${selected === incident.id ? "border-[var(--color-clay)] bg-[var(--color-tab-active)]" : "border-[var(--color-hairline)] hover:bg-[var(--color-inset)]"}`}>
              <span className="flex flex-wrap justify-between gap-2 pr-8 text-xs text-[var(--color-ink-muted)]"><span>{sourceLabels[incident.source]}</span><span>{statusLabels[incident.status]}</span></span>
              <span className="mt-2 block break-words text-sm font-semibold">{incident.title}</span>
              <span className="mt-2 block break-words text-xs text-[var(--color-ink-muted)]">{incident.service} · {incident.severity} · {new Date(incident.created_at).toLocaleString()}</span>
              {incident.status === "investigating" && typeof incident.phases_done === "number" && <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">{incident.phases_done} {incident.phases_done === 1 ? "phase" : "phases"} done</span>}
            </button>
            <button
              type="button"
              aria-label={`Delete incident: ${incident.title}`}
              title="Delete incident"
              disabled={deleting}
              onClick={() => void deleteIncident(incident)}
              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-ink-muted)] transition hover:bg-[var(--color-status-critical)]/10 hover:text-[var(--color-status-critical)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-status-critical)] disabled:opacity-40"
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
            </button>
          </li>)}</ul>}
        </section>
        <section className="panel min-w-0 p-5" aria-label="Incident details">
          {!selected ? <div className="py-16 text-center"><h2 className="text-2xl">Every signal has a story</h2><p className="mt-3 text-sm text-[var(--color-ink-muted)]">Select an incident to view its evidence and investigation.</p></div> : detailError ? <p role="alert">{detailError}</p> : !detail ? <p>Loading investigation…</p> : <>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-[var(--color-ink-muted)]">{sourceLabels[detail.source]} · {detail.severity}</p><h2 className="mt-2 break-words text-2xl">{detail.title}</h2><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{detail.service}</p></div><span role="status" className="rounded-full bg-[var(--color-inset)] px-3 py-1 text-xs">{statusLabels[detail.status]}</span></div>
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                disabled={deleting}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--color-status-critical)]/25 px-2.5 py-1.5 text-xs text-[var(--color-status-critical)] transition hover:bg-[var(--color-status-critical)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-status-critical)] disabled:opacity-50"
                onClick={() => void deleteIncident(detail)}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
                {deleting ? "Deleting…" : "Delete incident"}
              </button>
            </div>

            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{detail.description}</p>
            {detail.evidence && detail.evidence.length > 0 && <details className="mt-5 rounded-lg border border-[var(--color-hairline)] p-3"><summary className="cursor-pointer text-sm">Log evidence ({detail.evidence.length} entries)</summary><div className="mt-3 max-h-80 space-y-2 overflow-auto font-mono text-xs">{detail.evidence.map((entry, i) => <p className="whitespace-pre-wrap break-words" key={i}>{entry.timestamp} [{entry.level}] {entry.message}</p>)}</div></details>}
            <div className="mt-6 border-t border-[var(--color-hairline)] pt-5">
              {detail.phases?.length ? <IncidentPhases
                plan={detail.phasePlan ?? []}
                phases={detail.phases}
                status={detail.status}
                onReviewReport={() => { reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); reportRef.current?.focus(); }}
              /> : <>
                <h3 className="mb-3 text-sm font-semibold">Investigation</h3>
                {detail.status === "queued" && <p className="text-sm text-[var(--color-ink-muted)]">Queued. The investigation starts automatically, usually within a few seconds.</p>}
                {detail.status === "investigating" && <p className="text-sm text-[var(--color-ink-muted)]">Starting the investigation… This page updates automatically.</p>}
              </>}
              {detail.report && <div ref={reportRef} tabIndex={-1} className="mt-6 scroll-mt-6 border-t border-[var(--color-hairline)] pt-5 outline-none"><p className="mb-3 text-xs text-[var(--color-clay-deep)]">Needs human review · No fixes have been applied.</p><Report markdown={detail.report} /></div>}
              {detail.status === "failed" && <><p role="alert" className="mb-3 text-sm text-[var(--color-status-critical)]">{detail.error}</p><button disabled={retrying} className={button} onClick={async () => {
                setRetrying(true);
                try { await request(`/${detail.id}/retry`, { method: "POST" }); setVersion(v => v + 1); }
                catch (e) { setDetailError(e instanceof Error ? e.message : "Retry failed"); }
                finally { setRetrying(false); }
              }}>{retrying ? "Queuing…" : "Retry investigation"}</button></>}
            </div>
          </>}
        </section>
      </div>
    </>}
  </>;
}
