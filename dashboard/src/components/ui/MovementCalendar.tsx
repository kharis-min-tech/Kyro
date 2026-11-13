"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Loader2, X } from "lucide-react";
import { edgeVenueApi, type DayMovement } from "@/lib/edgeVenue";

/**
 * Arrivals and departures for one day, hour by hour, behind a calendar button.
 *
 * The chart beside it averages the last 30 days; this answers "what happened on
 * THAT Sunday" — when people came in, when they left, and the hour the room was
 * fullest.
 */
export function MovementCalendar({ dates }: { dates: string[] }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string>(dates[0] ?? "");
  const [data, setData] = useState<DayMovement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !date) return;
    setLoading(true); setErr(null);
    edgeVenueApi.movement(date, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load that day"))
      .finally(() => setLoading(false));
  }, [open, date]);

  if (!dates.length) return null;
  const hours = data?.hours ?? [];
  const max = Math.max(1, ...hours.map((h) => Math.max(h.arrived, h.left, h.most)));
  const pretty = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Arrivals and departures by day"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{ background: "var(--bg-hover)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>
        <CalendarDays size={14} /> By day
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.7)" }}
          role="dialog" aria-label="Arrivals and departures by day">
          <div className="w-full max-w-2xl rounded-2xl p-5 flex flex-col gap-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Arrivals and departures</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Hour by hour, for one day</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ color: "var(--text-faint)" }}><X size={18} /></button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {dates.slice(0, 14).map((d) => (
                <button key={d} onClick={() => setDate(d)}
                  className="px-2.5 py-1 rounded-lg text-xs"
                  style={d === date
                    ? { background: "rgba(99,102,241,0.18)", color: "var(--accent-indigo)", border: "1px solid #6366f1" }
                    : { background: "var(--bg-hover)", color: "var(--text-secondary)", border: "1px solid transparent" }}>
                  {pretty(d)}
                </button>
              ))}
            </div>

            {loading && <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}><Loader2 size={12} className="animate-spin" /> Loading…</p>}
            {err && <p className="text-xs text-red-400">{err}</p>}

            {data && !loading && (
              <>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>Fullest</p>
                    <p className="text-xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{data.peak}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {data.peak_hour === null ? "—" : `at ${String(data.peak_hour).padStart(2, "0")}:00`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>Arrived</p>
                    <p className="text-xl font-bold tabular-nums" style={{ color: "#818cf8" }}>
                      {data.in_out_known ? hours.reduce((s, h) => s + h.arrived, 0) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>Left</p>
                    <p className="text-xl font-bold tabular-nums" style={{ color: "#f59e0b" }}>
                      {data.in_out_known ? hours.reduce((s, h) => s + h.left, 0) : "—"}
                    </p>
                  </div>
                </div>

                {!data.in_out_known && (
                  <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
                    style={{ background: "rgba(245,158,11,0.08)", color: "#fbbf24" }}>
                    Kyro couldn&apos;t follow people reliably on this day, so arrivals and departures aren&apos;t shown.
                    The attendance figures are unaffected.
                  </p>
                )}

                <div className="flex items-end gap-px" style={{ height: 110 }}>
                  {hours.map((h) => (
                    <div key={h.hour} className="flex-1 h-full flex items-end justify-center gap-px"
                      title={`${h.hour}:00 — ${h.arrived} arrived, ${h.left} left, ${h.most} in the room`}>
                      <div className="w-1/3 rounded-sm" style={{ height: `${(h.most / max) * 100}%`, background: "var(--border-strong)" }} />
                      <div className="w-1/3 rounded-sm" style={{ height: `${(h.arrived / max) * 100}%`, background: h.arrived ? "#818cf8" : "transparent" }} />
                      <div className="w-1/3 rounded-sm" style={{ height: `${(h.left / max) * 100}%`, background: h.left ? "#f59e0b" : "transparent" }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between">
                  {[0, 4, 8, 12, 16, 20].map((h) => <span key={h} className="text-[9px]" style={{ color: "#4b5563" }}>{h}h</span>)}
                </div>
                <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--text-faint)" }}>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--border-strong)" }} /> In the room</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#818cf8" }} /> Arrived</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#f59e0b" }} /> Left</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
