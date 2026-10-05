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
import { Webhook, Send, CheckCircle, XCircle, Loader2, Copy, Eye, EyeOff } from "lucide-react";

const STORAGE_KEY = "kyro_integrations_config";
const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";

interface Config {
  url: string;
  secret: string;
  enabled: boolean;
}

function loadConfig(): Config {
  if (typeof window === "undefined") return { url: "", secret: "", enabled: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { url: "", secret: "", enabled: false, ...JSON.parse(raw) };
  } catch {}
  return { url: "", secret: "", enabled: false };
}

function saveConfig(c: Config) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
}

function buildPayload(forTest: boolean): Record<string, unknown> {
  // In demo mode we read whatever stats are visible to approximate a
  // real end-of-service snapshot. On the backend this comes directly
  // from the attendance DB.
  const manual = (() => {
    try {
      const raw = localStorage.getItem("kyro_manual_counts");
      if (!raw) return [];
      const all: { zone: string; count: number; session_id: string }[] = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      return all.filter((m) => m.session_id === today);
    } catch { return []; }
  })();
  const manualTotal = manual.reduce((a, m) => a + m.count, 0);

  // Fake-ish camera numbers for the demo payload — the real backend
  // populates this from Postgres.
  const cameraTotal = forTest ? 42 : 120;
  const capacity    = 300;
  const grand       = cameraTotal + manualTotal;

  return {
    service_date: new Date().toISOString().slice(0, 10),
    counted_at:   new Date().toISOString(),
    totals: {
      camera_count:   cameraTotal,
      manual_count:   manualTotal,
      grand_total:    grand,
      capacity,
      utilisation:    Math.round((grand / capacity) * 1000) / 1000,
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

export default function IntegrationsPage() {
  const [cfg, setCfg]           = useState<Config>({ url: "", secret: "", enabled: false });
  const [showSecret, setShowSecret] = useState(false);
  const [sending, setSending]   = useState<"test" | "live" | null>(null);
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const save = useCallback(() => {
    saveConfig(cfg);
    setResult({ ok: true, msg: "Settings saved" });
    setTimeout(() => setResult(null), 2500);
  }, [cfg]);

  const send = useCallback(async (mode: "test" | "live") => {
    if (!cfg.url.trim()) {
      setResult({ ok: false, msg: "Set a webhook URL first" });
      return;
    }
    setSending(mode);
    setResult(null);
    const payload = buildPayload(mode === "test");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.secret.trim()) headers["X-Kyro-Secret"] = cfg.secret.trim();
      const res = await fetch(cfg.url.trim(), {
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
        setResult({ ok: true, msg: mode === "test"
          ? "Test payload accepted by the receiver"
          : "End-of-service payload sent" });
      }
    } catch (e: unknown) {
      // Browser swallows CORS failures as a bare TypeError without details.
      // Tell the user exactly what to check instead of a vague "Network error".
      const msg = e instanceof Error ? e.message : "Network error";
      const corsNote = msg.toLowerCase().includes("failed to fetch")
        ? " (Most common cause: the receiving server didn't send an "
          + "'Access-Control-Allow-Origin' header permitting this page. "
          + "Try pointing the URL at https://webhook.site/#!/view for a "
          + "quick CORS-friendly test receiver, or configure your receiver "
          + "to allow this origin.)"
        : "";
      setResult({ ok: false, msg: `Send failed: ${msg}.${corsNote}` });
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

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cfg.enabled}
                onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-white">Auto-send at end of each service</span>
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

            {result && (
              <div className={`rounded-lg px-3 py-2 flex items-start gap-2 ${result.ok ? "text-green-300" : "text-red-300"}`}
                style={{
                  background: result.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
                  border: `1px solid ${result.ok ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"}`,
                }}>
                {result.ok ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
                <span className="text-xs leading-relaxed">{result.msg}</span>
              </div>
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
          Auto-send at end of each service requires the Kyro backend to be
          running. Without a backend, use <em>Send end-of-service now</em> to post
          the current snapshot manually.
        </p>
      </main>
    </div>
  );
}
