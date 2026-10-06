"use client";

/**
 * Integrations — outbound webhook that fires at the end of each service.
 *
 * UI shape:
 *  - Admin enters a webhook URL (POST target) + optional secret.
 *  - "Send a test" button posts a sample payload immediately so the
 *    receiving system can be verified before relying on it.
 *  - "Send end-of-service now" button posts the current attendance
 *    snapshot — useful for manual services or to replay a missed send.
 *  - On the real backend, a scheduled task fires the webhook at the
 *    configured time each Sunday (noted in the UI).
 *
 * Payload contract (what we POST):
 *  {
 *    service_date: "2026-10-05",
 *    counted_at:   "2026-10-05T11:30:00Z",
 *    totals: {
 *      camera_count:   120,     // from AI vision
 *      manual_count:    35,     // from Manual Count page
 *      grand_total:    155,
 *      capacity:       300,
 *      utilisation:   0.517,
 *    },
 *    by_zone: [ {zone, count, source: "camera"|"manual"}, ... ],
 *    source: "kyro",
 *    kyro_version: "0.2.0",
 *  }
 */

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { syncTodayCounts } from "@/lib/manualCountsShared";
import { Webhook, Send, CheckCircle, XCircle, Loader2, Copy, Eye, EyeOff, AlertTriangle } from "lucide-react";

const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";

interface Config {
  url: string;
  secret: string;
  enabled: boolean;
}

// Mode-scoped: Demo tests go to one receiver, Live production to another,
// without one bleeding into the other.
function storageKey(): string {
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  return `kyro_${mode}_integrations_config`;
}

function loadConfig(): Config {
  if (typeof window === "undefined") return { url: "", secret: "", enabled: false };
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return { url: "", secret: "", enabled: false, ...JSON.parse(raw) };
  } catch {}
  return { url: "", secret: "", enabled: false };
}

function saveConfig(c: Config) {
  try { localStorage.setItem(storageKey(), JSON.stringify(c)); } catch {}
}

// Local YYYY-MM-DD — must match manual-count/page.tsx's currentSessionId()
// so submitted counts actually line up with "today's" filter below.
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildPayload(forTest: boolean): Record<string, unknown> {
  const today = todayLocal();
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  const manual = (() => {
    try {
      const raw = localStorage.getItem(`kyro_${mode}_manual_counts`);
      if (!raw) return [];
      const all: { zone: string; count: number; session_id: string; approved?: boolean }[] = JSON.parse(raw);
      // Only approved counts (or legacy records without the field) ride
      // the webhook. Drafts stay out of the payload until the operator
      // signs off at the end of service.
      return all.filter((m) => m.session_id === today && m.approved !== false);
    } catch { return []; }
  })();
  const manualTotal = manual.reduce((a, m) => a + m.count, 0);

  // Honest numbers only. In a test payload we use recognisable sample
  // values (42 / "Main Floor") so the receiving system can tell at a
  // glance that it's a dry-run. In a live send we have no AI backend
  // here, so camera_count comes through as 0 and the receiver sees the
  // real manual total — not a fabricated 120 that misrepresents the day.
  const cameraTotal = forTest ? 42 : 0;
  const capacity    = 300;
  const grand       = cameraTotal + manualTotal;

  return {
    service_date: today,
    counted_at:   new Date().toISOString(),
    mode:         typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo"),
    totals: {
      camera_count:   cameraTotal,
      manual_count:   manualTotal,
      grand_total:    grand,
      capacity,
      utilisation:    capacity > 0 ? Math.round((grand / capacity) * 1000) / 1000 : 0,
    },
    by_zone: [
      ...manual.map((m) => ({ zone: m.zone, count: m.count, source: "manual" as const })),
      ...(forTest
        ? [{ zone: "Main Floor", count: cameraTotal, source: "camera" as const }]
        : []),
    ],
    source: "kyro",
    kyro_version: "0.2.0",
    ...(forTest ? { test: true } : {}),
  };
}

function isValidHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch { return false; }
}

export default function IntegrationsPage() {
  const [cfg, setCfg]           = useState<Config>({ url: "", secret: "", enabled: false });
  const [showSecret, setShowSecret] = useState(false);
  const [sending, setSending]   = useState<"test" | "live" | null>(null);
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const save = useCallback(() => {
    const url = cfg.url.trim();
    if (url && !isValidHttpsUrl(url)) {
      setResult({ ok: false, msg: "URL must start with https:// (or http:// for local testing)" });
      return;
    }
    saveConfig(cfg);
    setResult({ ok: true, msg: "Settings saved" });
    setTimeout(() => setResult(null), 2500);
  }, [cfg]);

  // On the Cloudflare static build there is no backend scheduler to fire
  // the auto-send, so the checkbox is misleading unless we say so.
  const hasBackend = !!process.env.NEXT_PUBLIC_API_URL;

  const send = useCallback(async (mode: "test" | "live") => {
    const url = cfg.url.trim();
    if (!url) {
      setResult({ ok: false, msg: "Set a webhook URL first" });
      return;
    }
    if (!isValidHttpsUrl(url)) {
      setResult({ ok: false, msg: "URL must start with https:// (or http:// for local testing)" });
      return;
    }
    setSending(mode);
    setResult(null);
    // Live on Cloudflare: make sure the payload has every usher's approved counts.
    await syncTodayCounts(todayLocal());
    const payload = buildPayload(mode === "test");
    const okMsg = mode === "test"
      ? "Test payload accepted by the receiver"
      : "End-of-service payload sent";

    // Preferred path: the Cloudflare Worker posts server-side, so the
    // receiver doesn't need to allow CORS (Slack, Zapier, Google Apps
    // Script, Discord… don't). If the relay isn't there (local `next dev`,
    // NAS build) we fall through to a direct browser POST below.
    try {
      const relay = await fetch("/api/relay/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, secret: cfg.secret, payload }),
      });
      const isJson = (relay.headers.get("content-type") ?? "").includes("application/json");
      if (isJson && relay.status !== 404) {
        const data = await relay.json() as {
          relayed?: boolean; ok?: boolean; status?: number; statusText?: string; body?: string; error?: string;
        };
        if (data.relayed && data.ok) {
          setResult({ ok: true, msg: `${okMsg} (HTTP ${data.status})` });
        } else if (data.relayed) {
          // Skip HTML error pages — only short text/JSON bodies help here.
          const detail = data.body && !data.body.trimStart().startsWith("<") ? ` — ${data.body.slice(0, 160)}` : "";
          setResult({ ok: false, msg: `Receiver returned ${data.status} ${data.statusText ?? ""}${detail}` });
        } else {
          setResult({ ok: false, msg: data.error ?? `Relay error (${relay.status})` });
        }
        setSending(null);
        return;
      }
    } catch { /* no relay reachable — use direct POST */ }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.secret.trim()) headers["X-Kyro-Secret"] = cfg.secret.trim();
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        // Keep CORS lenient — the receiving system should handle whatever
        // comes in. If their server doesn't allow CORS, this fetch will
        // fail and we tell the user to inspect their endpoint.
        mode: "cors",
      });
      if (!res.ok) {
        setResult({ ok: false, msg: `Receiver returned ${res.status} ${res.statusText}` });
      } else {
        setResult({ ok: true, msg: okMsg });
      }
    } catch (e: unknown) {
      // Browser swallows CORS failures as a bare TypeError without details.
      // Tell the user exactly what to check instead of a vague "Network error".
      const msg = e instanceof Error ? e.message : "Network error";
      const corsNote = msg.toLowerCase().includes("failed to fetch")
        ? " — Most common cause: the receiving server did not send an "
          + "'Access-Control-Allow-Origin' header permitting this page. "
          + "Quick working test: paste a fresh URL from https://webhook.site "
          + "(it accepts cross-origin posts out of the box)."
        : "";
      setResult({ ok: false, msg: `Send failed: ${msg}${corsNote}` });
    } finally {
      setSending(null);
    }
  }, [cfg]);

  function copyPayload() {
    navigator.clipboard?.writeText(JSON.stringify(buildPayload(true), null, 2));
    setResult({ ok: true, msg: "Sample payload copied to clipboard" });
    setTimeout(() => setResult(null), 2500);
  }

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      <main className="flex-1 pt-14 md:pt-0 p-3 sm:p-6 overflow-auto max-w-3xl flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Webhook size={18} /> Integrations
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Push Kyro&apos;s end-of-service attendance total to another system — your
            denomination&apos;s reporting portal, a Google Sheet via Zapier, Slack, etc.
          </p>
        </div>

        {/* Config */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-sm font-semibold text-white">Webhook settings</p>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Webhook URL (HTTPS)</label>
              <input
                type="url"
                value={cfg.url}
                onChange={(e) => setCfg((c) => ({ ...c, url: e.target.value }))}
                placeholder="https://your-system.example.com/kyro/attendance"
                className="rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                Shared secret (optional — sent as X-Kyro-Secret header)
              </label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
                <input
                  type={showSecret ? "text" : "password"}
                  value={cfg.secret}
                  onChange={(e) => setCfg((c) => ({ ...c, secret: e.target.value }))}
                  placeholder="any string your receiver verifies"
                  className="flex-1 bg-transparent text-sm text-white focus:outline-none font-mono"
                />
                <button type="button" onClick={() => setShowSecret((p) => !p)}
                  className="text-gray-500 hover:text-white shrink-0">
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={cfg.enabled}
                onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))}
                className="w-4 h-4 rounded mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>Auto-send at end of each service</span>
                {!hasBackend && (
                  <p className="text-xs mt-0.5 flex items-start gap-1.5" style={{ color: "#f59e0b" }}>
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>
                      Needs a backend scheduler to fire — this static Cloudflare build
                      cannot run cron jobs. Until a backend is wired up, use
                      <strong> Send end-of-service now</strong> manually after each service.
                    </span>
                  </p>
                )}
              </div>
            </label>

            <div className="flex flex-wrap gap-2">
              <button onClick={save}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: "#4f46e5" }}>
                Save settings
              </button>
              <button onClick={() => send("test")} disabled={!cfg.url.trim() || sending !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{ background: "var(--bg-hover)", border: `1px solid ${BORDER}` }}>
                {sending === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send a test
              </button>
              <button onClick={() => send("live")} disabled={!cfg.url.trim() || sending !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#86efac" }}>
                {sending === "live" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send end-of-service now
              </button>
            </div>

            {/* Result banner — bigger / bolder than the previous version so
               it's not possible to click Send and think 'nothing happened'. */}
            {result && (
              <div className={`rounded-xl px-4 py-3 flex items-start gap-3 ${result.ok ? "text-green-300" : "text-red-300"}`}
                style={{
                  background: result.ok ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
                  border: `1px solid ${result.ok ? "rgba(16,185,129,0.45)" : "rgba(239,68,68,0.45)"}`,
                  fontSize: 13,
                }}>
                {result.ok ? <CheckCircle size={18} className="mt-0.5 shrink-0" /> : <XCircle size={18} className="mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold mb-0.5">
                    {result.ok ? "Sent successfully" : "Could not send"}
                  </p>
                  <p className="text-xs leading-relaxed opacity-90">{result.msg}</p>
                </div>
              </div>
            )}

            {/* Zero-feedback guard: if the user hasn't entered a URL yet
               show a hint so clicking the disabled button has context. */}
            {!cfg.url.trim() && (
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                Enter a webhook URL above, then click <strong>Send a test</strong>.
              </p>
            )}
          </div>
        </div>

        {/* Payload reference */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-sm font-semibold text-white">What gets POSTed</p>
            <button onClick={copyPayload}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs"
              style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}>
              <Copy size={11} /> Copy sample
            </button>
          </div>
          <pre className="p-5 text-xs text-gray-300 overflow-x-auto font-mono leading-relaxed"
            style={{ background: "var(--bg-inset)" }}>
{JSON.stringify(buildPayload(true), null, 2)}
          </pre>
        </div>

        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          Use <em>Send end-of-service now</em> after each service to push the
          current attendance snapshot to the receiving system.
        </p>
      </main>
    </div>
  );
}
