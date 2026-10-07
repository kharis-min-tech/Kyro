"use client";

/**
 * Integrations — send each service's attendance total to another system
 * (Zapier → Google Sheets, a reporting portal, Slack…) via a webhook.
 *
 * Live mode on Cloudflare: settings live on the Kyro server
 * (worker/integrations.js). "Send a test" / "Send today's total now" are
 * sent by the server using every usher's approved counts, and "Send
 * automatically" is fired by the Worker's 15-minute cron at the chosen
 * day/time — no browser needs to be open.
 *
 * Demo mode: settings and counts stay in this browser; sends go through the
 * Worker's relay so receivers don't need to allow CORS.
 *
 * Payload: { service_date, counted_at, mode, totals: { camera_count,
 * manual_count, grand_total }, by_zone: [{ zone, count, source, approved_by }],
 * source: "kyro", kyro_version, test? }
 */

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { isEdgeLive, edgeFetch } from "@/lib/edgeAuth";
import { Webhook, Send, CheckCircle, XCircle, Loader2, Copy, Eye, EyeOff, Clock, Info } from "lucide-react";

const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Auto { enabled: boolean; days: number[]; time: string; tz: string }
interface LastSent { at: string; date: string; how: "auto" | "manual"; ok: boolean; status: number | null; error?: string }
interface Config { url: string; secret: string; auto: Auto }
type Payload = Record<string, unknown>;

const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"; } catch { return "Europe/London"; } };
const defaultConfig = (): Config => ({ url: "", secret: "", auto: { enabled: false, days: [0], time: "12:30", tz: browserTz() } });

// ── Demo mode: settings and counts stay in this browser ──────────────────────
// (Live mode on Cloudflare keeps them on the Kyro server — see worker/integrations.js.)
function demoKey(): string {
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  return `kyro_${mode}_integrations_config`;
}
function loadLocalConfig(): Config {
  try {
    const raw = localStorage.getItem(demoKey());
    if (raw) { const c = JSON.parse(raw); return { ...defaultConfig(), url: c.url ?? "", secret: c.secret ?? "" }; }
  } catch {}
  return defaultConfig();
}

// Local YYYY-MM-DD — must match manual-count/page.tsx's currentSessionId().
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Same shape the Kyro server sends in Live mode. */
function buildLocalPayload(forTest: boolean): Payload {
  const today = todayLocal();
  const mode = localStorage.getItem("kyro_mode") ?? "demo";
  let manual: { zone: string; count: number; session_id: string; approved?: boolean; approved_by?: string }[] = [];
  try {
    manual = (JSON.parse(localStorage.getItem(`kyro_${mode}_manual_counts`) ?? "[]") as typeof manual)
      .filter((m) => m.session_id === today && m.approved !== false);
  } catch {}
  const manualTotal = manual.reduce((a, m) => a + m.count, 0);
  const cameraTotal = forTest ? 42 : 0;
  return {
    service_date: today,
    counted_at: new Date().toISOString(),
    mode,
    totals: { camera_count: cameraTotal, manual_count: manualTotal, grand_total: cameraTotal + manualTotal },
    by_zone: [
      ...manual.map((m) => ({ zone: m.zone, count: m.count, source: "manual", approved_by: m.approved_by ?? null })),
      ...(forTest ? [{ zone: "Main Floor", count: cameraTotal, source: "camera" }] : []),
    ],
    source: "kyro",
    kyro_version: "0.3.0",
    ...(forTest ? { test: true } : {}),
  };
}

function isValidUrl(raw: string): boolean {
  try { const u = new URL(raw.trim()); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}

function describeResult(r: { ok?: boolean; status?: number; statusText?: string; body?: string; error?: string }, okMsg: string) {
  if (r.ok) return { ok: true, msg: `${okMsg} — the receiving system answered “${r.status} ${r.statusText ?? "OK"}”.` };
  if (r.error) return { ok: false, msg: r.error };
  const detail = r.body && !r.body.trimStart().startsWith("<") ? ` — ${r.body.slice(0, 160)}` : "";
  return { ok: false, msg: `The receiving system said no: ${r.status} ${r.statusText ?? ""}${detail}. Check the URL is correct.` };
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function IntegrationsPage() {
  const [edge, setEdge]         = useState(false);   // Live on Cloudflare → settings on the server
  const [cfg, setCfg]           = useState<Config>(defaultConfig());
  const [hasSecret, setHasSecret] = useState(false);
  const [lastSent, setLastSent] = useState<LastSent | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [sending, setSending]   = useState<"test" | "live" | null>(null);
  const [saving, setSaving]     = useState(false);
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [preview, setPreview]   = useState<Payload | null>(null);

  const loadPreview = useCallback(async (useEdge: boolean) => {
    if (useEdge) {
      try { setPreview(await edgeFetch<Payload>("/api/integrations/preview?kind=test")); } catch {}
    } else {
      setPreview(buildLocalPayload(true));
    }
  }, []);

  useEffect(() => {
    const useEdge = isEdgeLive();
    setEdge(useEdge);
    if (!useEdge) { setCfg(loadLocalConfig()); loadPreview(false); return; }
    edgeFetch<{ url: string; has_secret: boolean; auto: Auto; last_sent: LastSent | null }>("/api/integrations")
      .then((c) => {
        setCfg({ url: c.url, secret: "", auto: { ...c.auto, tz: c.auto?.tz || browserTz() } });
        setHasSecret(c.has_secret);
        setLastSent(c.last_sent);
      })
      .catch((e: Error) => setResult({ ok: false, msg: e.message }));
    loadPreview(true);
  }, [loadPreview]);

  const save = useCallback(async () => {
    const url = cfg.url.trim();
    if (url && !isValidUrl(url)) { setResult({ ok: false, msg: "The URL must start with https://" }); return; }
    if (!edge) {
      try { localStorage.setItem(demoKey(), JSON.stringify({ url, secret: cfg.secret })); } catch {}
      setResult({ ok: true, msg: "Settings saved on this device." });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { url, auto: { ...cfg.auto, tz: browserTz() } };
      if (cfg.secret.trim()) body.secret = cfg.secret.trim();
      const c = await edgeFetch<{ has_secret: boolean; auto: Auto; last_sent: LastSent | null }>("/api/integrations", { method: "PUT", body: JSON.stringify(body) });
      setHasSecret(c.has_secret);
      setCfg((x) => ({ ...x, secret: "", auto: c.auto }));
      setResult({ ok: true, msg: c.auto.enabled
        ? `Saved. Kyro will send automatically every ${c.auto.days.map((d) => DAYS[d]).join(", ")} at ${c.auto.time}.`
        : "Saved." });
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Couldn't save" });
    } finally { setSaving(false); }
  }, [cfg, edge]);

  const send = useCallback(async (kind: "test" | "live") => {
    const url = cfg.url.trim();
    if (!url) { setResult({ ok: false, msg: "Enter and save a webhook URL first." }); return; }
    setSending(kind); setResult(null);
    const okMsg = kind === "test" ? "Test sent" : "Today's total sent";
    try {
      if (edge) {
        // The Kyro server sends it, using every usher's approved counts.
        const r = await edgeFetch<{ ok: boolean; status?: number; statusText?: string; body?: string; error?: string; payload: Payload }>(
          "/api/integrations/send", { method: "POST", body: JSON.stringify({ kind }) });
        setResult(describeResult(r, okMsg));
        if (kind === "live") setLastSent({ at: new Date().toISOString(), date: String(r.payload.service_date), how: "manual", ok: r.ok, status: r.status ?? null });
        return;
      }
      // Demo / self-hosted: relay through the Cloudflare Worker (no CORS problems).
      const relay = await fetch("/api/relay/webhook", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, secret: cfg.secret, payload: buildLocalPayload(kind === "test") }),
      });
      if ((relay.headers.get("content-type") ?? "").includes("application/json")) {
        const d = await relay.json() as { relayed?: boolean; ok?: boolean; status?: number; statusText?: string; body?: string; error?: string };
        setResult(d.relayed ? describeResult(d, okMsg) : { ok: false, msg: d.error ?? "Couldn't send" });
      } else {
        setResult({ ok: false, msg: "Sending needs the Kyro server, which isn't reachable from this address." });
      }
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Couldn't send" });
    } finally { setSending(null); }
  }, [cfg, edge]);

  function copyPayload() {
    navigator.clipboard?.writeText(JSON.stringify(preview, null, 2));
    setResult({ ok: true, msg: "Example copied to the clipboard." });
  }

  const toggleDay = (d: number) => setCfg((c) => {
    const days = c.auto.days.includes(d) ? c.auto.days.filter((x) => x !== d) : [...c.auto.days, d].sort();
    return { ...c, auto: { ...c.auto, days: days.length ? days : c.auto.days } };
  });

  const input = "rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0 p-3 sm:p-6 overflow-auto max-w-3xl flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Webhook size={18} /> Integrations
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Send each service&apos;s attendance total to another system — a Google Sheet (via Zapier),
            your denomination&apos;s reporting portal, Slack, and so on.
          </p>
        </div>

        {/* Plain-English explanation */}
        <div className="rounded-2xl px-5 py-4 flex gap-3" style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)" }}>
          <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>What happens when you send</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Kyro takes <strong>today&apos;s approved Manual Counts</strong> — every room and the total (drafts are left out).</li>
              <li>It posts them to your webhook address as a small data message, like the example at the bottom of this page.</li>
              <li><strong>Send a test</strong> adds a pretend camera count of 42 and is marked <code>&quot;test&quot;: true</code>, so you can check it arrives without confusing your records.</li>
              <li>Nothing is changed in Kyro — sending just shares a copy of the numbers.</li>
            </ul>
          </div>
        </div>

        {/* Settings */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-sm font-semibold text-white">Webhook settings</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {edge ? "Saved on the Kyro server — every admin sees the same settings." : "Demo mode — saved on this device only."}
            </p>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Webhook URL</label>
              <input type="url" value={cfg.url} onChange={(e) => setCfg((c) => ({ ...c, url: e.target.value }))}
                placeholder="https://hooks.zapier.com/hooks/catch/…" className={`${input} font-mono`}
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                Shared secret <span style={{ color: "var(--text-faint)" }}>(optional — only if your receiving system asks for one)</span>
              </label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
                <input type={showSecret ? "text" : "password"} value={cfg.secret}
                  onChange={(e) => setCfg((c) => ({ ...c, secret: e.target.value }))}
                  placeholder={hasSecret ? "•••••••• saved — type to replace" : "leave blank if not needed"}
                  className="flex-1 min-w-0 bg-transparent text-sm text-white focus:outline-none font-mono" />
                <button type="button" onClick={() => setShowSecret((p) => !p)} aria-label={showSecret ? "Hide secret" : "Show secret"}
                  className="text-gray-500 hover:text-white shrink-0">
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Automatic sending — Live (server) only */}
            {edge ? (
              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cfg.auto.enabled}
                    onChange={(e) => setCfg((c) => ({ ...c, auto: { ...c.auto, enabled: e.target.checked } }))}
                    className="w-4 h-4 rounded" />
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Send automatically after each service</span>
                </label>
                {cfg.auto.enabled && (
                  <>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                      {DAYS.map((d, i) => (
                        <button key={d} type="button" onClick={() => toggleDay(i)} aria-pressed={cfg.auto.days.includes(i)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium"
                          style={cfg.auto.days.includes(i)
                            ? { background: "#4f46e5", color: "#fff" }
                            : { background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                      <Clock size={14} /> at
                      <input type="time" value={cfg.auto.time}
                        onChange={(e) => setCfg((c) => ({ ...c, auto: { ...c.auto, time: e.target.value } }))}
                        className={input} style={{ background: "var(--bg-card)", border: `1px solid ${BORDER}` }} />
                    </label>
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                      Pick a time after the final count is usually approved. Kyro sends once on each chosen day, within 15 minutes of that time, even if nobody has Kyro open.
                    </p>
                  </>
                )}
                {lastSent && (
                  <p className="text-xs" style={{ color: lastSent.ok ? "#4ade80" : "#f87171" }}>
                    Last sent {fmtWhen(lastSent.at)} ({lastSent.how === "auto" ? "automatically" : "by hand"}) — {lastSent.ok ? "delivered" : `failed${lastSent.status ? ` (${lastSent.status})` : ""}`}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                Automatic sending after each service is available when you sign in to Live mode.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: "#4f46e5", color: "#fff" }}>
                {saving ? "Saving…" : "Save settings"}
              </button>
              <button onClick={() => send("test")} disabled={!cfg.url.trim() || sending !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{ background: "var(--bg-hover)", border: `1px solid ${BORDER}` }}>
                {sending === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send a test
              </button>
              <button onClick={() => send("live")} disabled={!cfg.url.trim() || sending !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#16a34a" }}>
                {sending === "live" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send today&apos;s total now
              </button>
            </div>
            {edge && (
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                Save your settings before sending — Kyro sends from the server using the saved URL.
              </p>
            )}

            {result && (
              <div className={`rounded-xl px-4 py-3 flex items-start gap-3 ${result.ok ? "text-green-300" : "text-red-300"}`}
                style={{
                  background: result.ok ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
                  border: `1px solid ${result.ok ? "rgba(16,185,129,0.45)" : "rgba(239,68,68,0.45)"}`, fontSize: 13,
                }}>
                {result.ok ? <CheckCircle size={18} className="mt-0.5 shrink-0" /> : <XCircle size={18} className="mt-0.5 shrink-0" />}
                <p className="text-xs leading-relaxed flex-1 min-w-0" style={{ color: result.ok ? "#16a34a" : "#dc2626" }}>{result.msg}</p>
              </div>
            )}
          </div>
        </div>

        {/* Example payload */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <div>
              <p className="text-sm font-semibold text-white">What gets sent (example)</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>A test send, using today&apos;s real approved counts</p>
            </div>
            <button onClick={copyPayload}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs shrink-0"
              style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}>
              <Copy size={11} /> Copy
            </button>
          </div>
          <pre className="p-5 text-xs text-gray-300 overflow-x-auto font-mono leading-relaxed" style={{ background: "var(--bg-inset)" }}>
{preview ? JSON.stringify(preview, null, 2) : "Loading…"}
          </pre>
        </div>
      </main>
    </div>
  );
}
