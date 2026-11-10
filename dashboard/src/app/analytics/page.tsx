"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { analyticsApi } from "@/lib/api";
import { Sidebar } from "@/components/layout/Sidebar";
import { CameraSwitcher } from "@/components/layout/CameraSwitcher";
import { MovementCalendar } from "@/components/ui/MovementCalendar";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE, makeDemoAnalytics } from "@/lib/demo";
import { isEdgeLive } from "@/lib/edgeAuth";
import { edgeVenueApi, type DeletedDay } from "@/lib/edgeVenue";
import { useCameras } from "@/hooks/useCameras";

function isLiveMode(): boolean { if (typeof window === "undefined") return false; return localStorage.getItem("kyro_mode") === "live"; }
const inDemoMode = () => typeof window !== "undefined" && (localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL);
import { TrendingUp, Users, Calendar, BarChart2, Search, X, ArrowUp, ArrowDown, Minus, Trash2, RotateCcw } from "lucide-react";
import { DatePicker } from "@/components/ui/DatePicker";
import type { AttendancePoint, AnalyticsSummary, HourlyBucket } from "@/types";

const BG      = "var(--bg-base)";
const CARD_BG = "var(--bg-card)";
const BORDER  = "var(--border-subtle)";
const DEFAULT_CAMERA = process.env.NEXT_PUBLIC_CAMERA_ID ?? "cam-01";
/** Edge Live (Cloudflare build, no backend): how many days /api/live/daily covers. */
const EDGE_DAYS = 30;

// Safely parse a date from ISO string using UTC
function parseUTC(ts: string) { return new Date(ts); }
const DAYS_LONG  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── Stat card ────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType; accent?: string;
}) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "#6b7280" }}>{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accent ? `${accent}18` : "var(--border-subtle)" }}>
          <Icon size={15} style={{ color: accent ?? "#6b7280" }} />
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold text-white tabular-nums leading-none">{value}</p>
        {sub && <p className="text-xs mt-1.5" style={{ color: "var(--text-faint)" }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Day detail panel ─────────────────────────────────────────────────────────
function DayDetail({ point, allData, onClose }: { point: AttendancePoint; allData: AttendancePoint[]; onClose: () => void; }) {
  const d       = parseUTC(point.timestamp);
  const dayName = DAYS_LONG[d.getUTCDay()];
  const dateStr = `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const avg     = allData.reduce((s, x) => s + x.attendance, 0) / (allData.length || 1);
  const diff    = Math.round(point.attendance - avg);
  const diffPct = avg > 0 ? Math.round((diff / avg) * 100) : 0;
  const sameDay = allData.filter((x) => parseUTC(x.timestamp).getUTCDay() === d.getUTCDay());
  const idx     = sameDay.findIndex((x) => x.timestamp === point.timestamp);
  const prev    = idx > 0 ? sameDay[idx - 1] : null;
  const prevDiff = prev ? point.attendance - prev.attendance : null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <p className="text-sm font-bold text-white">{dateStr}</p>
          <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{dayName}</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-xl p-4 flex flex-col gap-1 min-w-0" style={{ background: "var(--bg-base)", border: `1px solid ${BORDER}` }}>
          <p className="text-xs whitespace-nowrap" style={{ color: "#6b7280" }}>Attendance</p>
          <p className="text-2xl font-bold text-white tabular-nums">{point.attendance.toLocaleString()}</p>
          <div className="flex items-center gap-1 text-xs flex-wrap">
            {diff > 0 ? <><ArrowUp size={10} className="text-green-400" /><span className="text-green-400">+{diff} vs avg</span></>
              : diff < 0 ? <><ArrowDown size={10} className="text-red-400" /><span className="text-red-400">{diff} vs avg</span></>
              : <><Minus size={10} style={{ color:"#6b7280" }}/><span style={{ color:"#6b7280" }}>At average</span></>}
          </div>
        </div>
        <div className="rounded-xl p-4 flex flex-col gap-1 min-w-0" style={{ background: "var(--bg-base)", border: `1px solid ${BORDER}` }}>
          <p className="text-xs whitespace-nowrap" style={{ color: "#6b7280" }}>Occupancy</p>
          <p className="text-2xl font-bold tabular-nums" style={{ color: "#818cf8" }}>{point.occupancy_pct.toFixed(1)}%</p>
          <p className="text-xs whitespace-nowrap" style={{ color: "var(--text-faint)" }}>Of seat capacity</p>
        </div>
        <div className="rounded-xl p-4 flex flex-col gap-1 min-w-0" style={{ background: "var(--bg-base)", border: `1px solid ${BORDER}` }}>
          <p className="text-xs whitespace-nowrap" style={{ color: "#6b7280" }}>vs last {dayName}</p>
          {prevDiff !== null ? (
            <>
              <p className="text-2xl font-bold tabular-nums"
                style={{ color: prevDiff > 0 ? "#4ade80" : prevDiff < 0 ? "#f87171" : "#9ca3af" }}>
                {prevDiff > 0 ? "+" : ""}{prevDiff}
              </p>
              <p className="text-xs whitespace-nowrap" style={{ color: "var(--text-faint)" }}>Prev: {prev!.attendance.toLocaleString()}</p>
            </>
          ) : <p className="text-xs mt-2" style={{ color: "var(--text-faint)" }}>No prior data</p>}
        </div>
      </div>
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: "#6b7280" }}>vs 30-day average ({Math.round(avg).toLocaleString()})</span>
          <span className="text-xs font-semibold" style={{ color: diffPct > 0 ? "#4ade80" : diffPct < 0 ? "#f87171" : "#9ca3af" }}>
            {diffPct > 0 ? "+" : ""}{diffPct}%
          </span>
        </div>
        <div className="rounded-full overflow-hidden" style={{ height: 6, background: "var(--border-subtle)" }}>
          <div className="h-full rounded-full"
            style={{ width: `${Math.min(100,(point.attendance/(avg*1.5))*100)}%`,
                     background: diffPct > 10 ? "#4ade80" : diffPct < -10 ? "#f87171" : "#818cf8" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Trend chart ──────────────────────────────────────────────────────────────
function TrendChart({ data }: { data: AttendancePoint[] }) {
  if (!data.length) return (
    <div className="rounded-2xl p-5 flex items-center justify-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, height: 200 }}>
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>No data for selected range</p>
    </div>
  );
  const values = data.map((d) => d.attendance);
  const max = Math.max(...values, 1), min = Math.min(...values), range = max - min || 1;
  const H = 140, W = data.length;
  const yFor = (v: number) => H-((v-min)/range)*(H-20)-10;
  // One day of data: draw it as a flat line across (a single point has no width).
  const pts = W === 1
    ? `0,${yFor(values[0])} 100,${yFor(values[0])}`
    : data.map((d, i) => `${(i/(W-1))*100},${yFor(d.attendance)}`).join(" ");
  return (
    <div className="rounded-2xl p-5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between mb-4">
        <div><p className="text-sm font-semibold text-white">Attendance trend</p>
          <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>Last {data.length} days</p></div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "#6b7280" }}>
          <span>High: <span className="text-white font-semibold">{max}</span></span>
          <span>Low: <span className="text-white font-semibold">{min}</span></span>
        </div>
      </div>
      <svg viewBox={`0 0 100 ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
        <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
        </linearGradient></defs>
        {[0,0.25,0.5,0.75,1].map((t) => <line key={t} x1="0" y1={H-t*(H-20)-10} x2="100" y2={H-t*(H-20)-10} stroke="var(--border-subtle)" strokeWidth="0.5"/>)}
        <polygon points={`0,${H} ${pts} 100,${H}`} fill="url(#ag)"/>
        <polyline points={pts} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
      </svg>
      <div className="flex justify-between mt-2 px-0.5">
        {[0,Math.floor(W/4),Math.floor(W/2),Math.floor(3*W/4),W-1].map((i) => {
          const d = data[i]; if (!d) return null;
          const dt = parseUTC(d.timestamp);
          return <span key={i} className="text-xs" style={{ color: "var(--text-faint)" }}>{dt.getUTCDate()}/{dt.getUTCMonth()+1}</span>;
        })}
      </div>
    </div>
  );
}

// ─── Arrival chart ────────────────────────────────────────────────────────────
function ArrivalChart({ data, movementDays, byDayDates, fromRegister }: { data: HourlyBucket[]; movementDays?: number; byDayDates?: string[]; fromRegister?: boolean }) {
  if (!data.length) return null;
  const anyMovement = data.some((d) => d.count > 0 || (d.exits ?? 0) > 0);
  const max  = Math.max(...data.map((d) => Math.max(d.count, d.exits ?? 0)), 1);
  const peak = data.reduce((a, b) => (a.count > b.count ? a : b));
  // The chart is an average per hour, so adding the hours up gives an average
  // day — not a running total of everyone who has ever come in.
  const totalIn = data.reduce((n, b) => n + (b.count || 0), 0);
  const totalOut = data.reduce((n, b) => n + (b.exits ?? 0), 0);
  return (
    <div className="rounded-2xl p-5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">Arrivals and departures</p>
            {byDayDates && byDayDates.length > 0 && <MovementCalendar dates={byDayDates} />}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>By hour, averaged over the days Kyro could follow people</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "#6b7280" }}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#818cf8" }} /> Arrived
            </span>
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "#6b7280" }}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#f59e0b" }} /> Left
            </span>
          </div>
        </div>
        {/* The totals. The chart is an average per hour, so these are what an
            average day looks like end to end — which is the number most people
            come to this card for, and it wasn't anywhere on it. */}
        <div className="shrink-0 flex items-start gap-4">
          <div>
            <p className="text-[10px]" style={{ color: "#6b7280" }}>Arrived</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: "#818cf8" }}>{totalIn.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px]" style={{ color: "#6b7280" }}>Left</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: "#f59e0b" }}>{totalOut.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px]" style={{ color: "#6b7280" }}>Busiest</p>
            <p className="text-lg font-bold tabular-nums text-white">{peak.hour}:00</p>
          </div>
        </div>
      </div>
      {!anyMovement ? (
        <p className="text-xs leading-relaxed py-4" style={{ color: "#6b7280" }}>
          No movement Kyro can stand behind yet. Before the tracking fix it read the AI losing sight of someone as them leaving
          and arriving again, so those days are left out rather than shown as fact. The attendance figures for them are unaffected.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-px" style={{ height: 80 }}>
            {data.map((b) => {
              const inH = Math.max((b.count / max) * 100, b.count > 0 ? 4 : 0);
              const outH = Math.max(((b.exits ?? 0) / max) * 100, (b.exits ?? 0) > 0 ? 4 : 0);
              return (
                <div key={b.hour} className="flex-1 h-full flex items-end justify-center gap-px"
                  title={`${b.hour}:00 — ${b.count} arrived, ${b.exits ?? 0} left`}>
                  <div className="w-1/2 rounded-sm" style={{ height: `${inH}%`, background: b.count ? "#818cf8" : "var(--border-subtle)" }} />
                  <div className="w-1/2 rounded-sm" style={{ height: `${outH}%`, background: (b.exits ?? 0) ? "#f59e0b" : "var(--border-subtle)" }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2">
            {[0,4,8,12,16,20].map((h) => <span key={h} className="text-[9px]" style={{ color:"#4b5563" }}>{h}h</span>)}
          </div>
          {movementDays !== undefined && (
            <p className="text-[10px] mt-2" style={{ color: "#4b5563" }}>
              On an average day: {totalIn.toLocaleString()} arrived, {totalOut.toLocaleString()} left
              {movementDays > 1 && <> — about {(totalIn * movementDays).toLocaleString()} and {(totalOut * movementDays).toLocaleString()} across all {movementDays} days</>}.
              {" "}From {movementDays} {movementDays === 1 ? "day" : "days"} Kyro could follow people. Earlier days are left out.
              {fromRegister
                ? " Each person is counted once, however often they moved or stepped out."
                : " These come from the cameras' own tallies, which count crossings rather than people."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Weekly breakdown ─────────────────────────────────────────────────────────
function WeeklyBreakdown({ data }: { data: AttendancePoint[] }) {
  const byDow: Record<number,number[]> = {};
  data.forEach((d) => { const dow = parseUTC(d.timestamp).getUTCDay(); if(!byDow[dow])byDow[dow]=[]; byDow[dow].push(d.attendance); });
  const labels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const avgs   = labels.map((_,i) => { const v=byDow[i]??[]; return v.length?Math.round(v.reduce((a,b)=>a+b)/v.length):0; });
  const max    = Math.max(...avgs, 1);
  return (
    <div className="rounded-2xl p-5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <p className="text-sm font-semibold text-white mb-1">Average by day</p>
      <p className="text-xs mb-4" style={{ color: "#6b7280" }}>Based on filtered range</p>
      <div className="flex flex-col gap-2">
        {labels.map((day,i) => {
          const pct = (avgs[i]/max)*100;
          return (
            <div key={day} className="flex items-center gap-3">
              <span className="text-xs w-7 shrink-0" style={{ color:"#6b7280" }}>{day}</span>
              <div className="flex-1 rounded-full overflow-hidden" style={{ height:6, background:"var(--border-subtle)" }}>
                <div className="h-full rounded-full" style={{ width:`${pct}%`, background:pct>80?"#818cf8":pct>40?"#4f46e5":"var(--border-strong)" }}/>
              </div>
              <span className="text-xs tabular-nums w-8 text-right" style={{ color:avgs[i]>0?"#9ca3af": "var(--text-faint)" }}>
                {avgs[i]>0?avgs[i]:"—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Recent sessions table ────────────────────────────────────────────────────
function RecentSessions({ data, onSelect, selectedTs, canDelete, onDeleted }: {
  data: AttendancePoint[]; onSelect: (p: AttendancePoint) => void; selectedTs?: string;
  canDelete?: boolean; onDeleted?: () => void;
}) {
  const recent = [...data].reverse().slice(0, 10);
  const [confirm, setConfirm] = useState<string | null>(null);   // the date being confirmed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove(date: string) {
    setBusy(true); setErr(null);
    try {
      await edgeVenueApi.deleteDay(date, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      setConfirm(null); onDeleted?.();
    } catch (e: any) { setErr(e?.message ?? "Couldn't delete that service"); }
    setBusy(false);
  }
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <p className="text-sm font-semibold text-white">Recent services</p>
        <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>Click a row to see details</p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["Date","Day","Attendance","Occupancy"].map((h,i) => (
              <th key={h} className={`px-5 py-2.5 font-medium ${i>=2?"text-right":"text-left"}`} style={{ color:"#4b5563" }}>{h}</th>
            ))}
            {canDelete && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {recent.map((d, i) => {
            const dt  = parseUTC(d.timestamp);
            const day = dt.getUTCDate(), mon = dt.getUTCMonth()+1, yr = dt.getUTCFullYear(), dow = dt.getUTCDay();
            const sel = d.timestamp === selectedTs;
            return (
              <tr key={i} onClick={() => onSelect(d)}
                style={{ borderBottom: i<recent.length-1?`1px solid ${BORDER}`:"none",
                         background: sel?"rgba(99,102,241,0.1)":"transparent", cursor:"pointer" }}
                onMouseEnter={(e)=>{ if(!sel)(e.currentTarget as HTMLElement).style.background="var(--gold-soft)"; }}
                onMouseLeave={(e)=>{ (e.currentTarget as HTMLElement).style.background=sel?"rgba(99,102,241,0.1)":"transparent"; }}>
                <td className="px-5 py-3 font-medium" style={{ color:sel?"#818cf8": "var(--text-primary)" }}>{day}/{mon}/{yr}</td>
                <td className="px-5 py-3" style={{ color:"#6b7280" }}>{DAYS_LONG[dow]}</td>
                <td className="px-5 py-3 text-right font-semibold text-white tabular-nums">{d.attendance.toLocaleString()}</td>
                <td className="px-5 py-3 text-right tabular-nums" style={{ color:"#6366f1" }}>{d.occupancy_pct.toFixed(1)}%</td>
                {canDelete && (
                  <td className="px-3 py-3 text-right">
                    <button onClick={(e) => { e.stopPropagation(); setConfirm(d.timestamp.slice(0, 10)); }}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                      title="Delete this service" aria-label="Delete this service"><Trash2 size={13} /></button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {confirm && (
        <div className="mx-5 mb-4 rounded-xl px-4 py-3 flex flex-col gap-2"
          style={{ background: "rgba(185,28,28,0.1)", border: "1px solid rgba(185,28,28,0.4)" }}>
          <p className="text-sm font-semibold text-white">Delete the service on {confirm}?</p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Every count Kyro recorded that day is removed for good, along with any service recorded in it. It will disappear
            from here, the calendar and the charts. This can&apos;t be undone — it will be listed under <strong>Recently
            deleted</strong> for 30 days, then gone entirely. If a camera is still counting, today starts recording again
            from now, so stop counting first if you want the day left empty.
          </p>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-2 mt-1">
            <button onClick={() => remove(confirm)} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-700 hover:bg-red-600 disabled:opacity-50">
              <Trash2 size={11} /> {busy ? "Deleting…" : "Yes, delete it"}
            </button>
            <button onClick={() => { setConfirm(null); setErr(null); }}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What was deleted, so it is never invisible. Cleared automatically after 30 days. */
function DeletedServices({ reload, onRestored }: { reload: number; onRestored: () => void }) {
  const [days, setDays] = useState<DeletedDay[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { edgeVenueApi.deletedDays().then(setDays).catch(() => setDays([])); }, [reload]);

  async function restore(date: string) {
    setBusy(date); setErr(null);
    try { await edgeVenueApi.restoreDay(date); onRestored(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't bring that day back"); }
    setBusy(null);
  }

  if (!days || days.length === 0) return null;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <p className="text-sm font-semibold text-white">Recently deleted</p>
        <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
          Still here — bring one back any time within 30 days, after which it goes for good
        </p>
      </div>
      <div className="flex flex-col">
        {days.map((d, i) => (
          <div key={`${d.date}-${i}`} className="px-5 py-3 flex items-center gap-3"
            style={{ borderBottom: i < days.length - 1 ? `1px solid ${BORDER}` : "none" }}>
            <Trash2 size={13} className="shrink-0" style={{ color: "#6b7280" }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{d.date} · {d.attendance} people</p>
              <p className="text-xs" style={{ color: "#6b7280" }}>
                Deleted by {d.deleted_by} on {new Date(d.deleted_at).toLocaleDateString([], { day: "numeric", month: "short" })}
                {" · gone for good "}
                {new Date(Date.parse(d.deleted_at) + 30 * 86400000).toLocaleDateString([], { day: "numeric", month: "short" })}
              </p>
            </div>
            {d.recoverable === false ? (
              <span className="shrink-0 text-xs" style={{ color: "#6b7280" }} title="Deleted before Kyro could undo it">Can&apos;t be undone</span>
            ) : (
              <button onClick={() => restore(d.date)} disabled={busy === d.date}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
                <RotateCcw size={12} /> {busy === d.date ? "Bringing back…" : "Bring back"}
              </button>
            )}
          </div>
        ))}
        {err && <p className="text-xs text-red-400 px-5 py-2">{err}</p>}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [cameraId, setCameraId] = useState(DEFAULT_CAMERA);
  const { canViewAttendance, isAuthenticated, role } = useAuth();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  // Read once after mount (never during render) to avoid hydration mismatches.
  const [edge, setEdge] = useState(false);
  const [realDemo, setRealDemo] = useState(false);
  useEffect(() => {
    setHydrated(true);
    setEdge(isEdgeLive());
    setRealDemo(localStorage.getItem("kyro_mode") === "demo");
  }, []);
  // Edge Live: "" = all cameras; otherwise a camera id from CameraContext.
  const [edgeCamera, setEdgeCamera] = useState("");
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [deletedTick, setDeletedTick] = useState(0);
  const { cameras } = useCameras();
  useEffect(() => {
    if (!hydrated || inDemoMode()) return;
    if (!isAuthenticated) { router.replace("/login"); return; }
    if (!canViewAttendance) router.replace("/seating");
  }, [hydrated, isAuthenticated, canViewAttendance, router]);

  const [history,     setHistory]     = useState<AttendancePoint[]>([]);
  const [summary,     setSummary]     = useState<AnalyticsSummary | null>(null);
  const [arrival,     setArrival]     = useState<HourlyBucket[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [fromDate,    setFromDate]    = useState("");
  const [toDate,      setToDate]      = useState("");
  const [filtered,    setFiltered]    = useState<AttendancePoint[]>([]);
  const [selectedDay, setSelectedDay] = useState<AttendancePoint | null>(null);

  const applyFilter = useCallback((data: AttendancePoint[], q: string, from: string, to: string) => {
    let r = data;
    if (from) r = r.filter((d) => parseUTC(d.timestamp) >= parseUTC(from));
    if (to)   r = r.filter((d) => parseUTC(d.timestamp) <= parseUTC(to + "T23:59:59Z"));
    if (q) {
      const lower = q.toLowerCase();
      const dow   = DAYS_LONG.findIndex((d) => d.toLowerCase().startsWith(lower));
      r = dow >= 0
        ? r.filter((d) => parseUTC(d.timestamp).getUTCDay() === dow)
        : r.filter((d) => d.timestamp.toLowerCase().includes(q.toLowerCase()));
    }
    setFiltered(r);
  }, []);

  const loadData = useCallback(() => {
    // Only seed fake analytics when the user explicitly picked Demo mode.
    // In Live mode without a backend, show an empty state — the operator
    // hasn't recorded any analytics yet and shouldn't see invented data.
    const userChoseDemo = typeof window !== "undefined" && localStorage.getItem("kyro_mode") === "demo";
    if (userChoseDemo) {
      const { history: h, arrival: arr, summary: s } = makeDemoAnalytics();
      const live = h.map((d) => ({ ...d, attendance: Math.max(0, d.attendance + Math.round((Math.random()-0.5)*12)) }));
      setHistory(live);
      setSummary({ ...(s as AnalyticsSummary), avg_attendance: Math.round(live.reduce((a,b)=>a+b.attendance,0)/live.length) });
      setArrival(arr.map((b) => ({ ...b, count: Math.max(0, b.count + Math.round((Math.random()-0.5)*5)) })));
      setFiltered(live);
      setSelectedDay((prev) => {
        if (!prev) return null;
        return live.find((d) => d.timestamp === prev.timestamp) ?? prev;
      });
      setLoading(false);
      return;
    }
    // Live mode on the Cloudflare build: real daily counts from the cameras.
    if (isEdgeLive()) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      edgeVenueApi.daily(EDGE_DAYS, tz, edgeCamera || undefined)
        .then((d) => {
          // Anchor each point at midday UTC on its local date, so the
          // UTC-based date labels below show the church's calendar day.
          const h: AttendancePoint[] = (d.history ?? []).map((p) => ({
            timestamp: `${p.date}T12:00:00Z`, attendance: p.attendance, occupancy_pct: p.occupancy_pct,
          }));
          setHistory(h); setFiltered(h);
          setSummary(h.length ? (d.summary as AnalyticsSummary) : null);
          setArrival(h.length ? (d.arrival ?? []) : []);
          setSelectedDay((prev) => prev ? (h.find((x) => x.timestamp === prev.timestamp) ?? null) : null);
          setEdgeError(null);
          setUpdatedAt(new Date());
        })
        .catch((e) => setEdgeError(e instanceof Error ? e.message : "Couldn't load counts"))
        .finally(() => setLoading(false));
      return;
    }
    // Live mode without a backend: nothing to load.
    if (!process.env.NEXT_PUBLIC_API_URL) {
      setHistory([]); setSummary(null); setArrival([]); setFiltered([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([analyticsApi.history(cameraId,30), analyticsApi.summary(cameraId), analyticsApi.arrival(cameraId,30)])
      .then(([h,s,arr]) => { setHistory(h); setFiltered(h); setSummary(s); setArrival(arr); })
      .catch(console.error).finally(() => setLoading(false));
  }, [cameraId, edgeCamera]);

  useEffect(() => { loadData(); }, [loadData]);
  // Auto-refresh every 30s in real mode (demo already polls every 5s)
  useEffect(() => {
    if (isEdgeLive()) {
      // Live cameras: today's numbers include the count right now, so keep them fresh,
      // and catch up straight away when the page comes back into view.
      const t = setInterval(() => { if (!document.hidden) loadData(); }, 10_000);
      const back = () => { if (!document.hidden) loadData(); };
      document.addEventListener("visibilitychange", back);
      window.addEventListener("focus", back);
      return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
    }
    if (inDemoMode()) {
      const t = setInterval(loadData, 5000);
      return () => clearInterval(t);
    } else {
      const t = setInterval(loadData, 30_000);
      return () => clearInterval(t);
    }
  }, [loadData]);
  useEffect(() => { applyFilter(history, search, fromDate, toDate); }, [history, search, fromDate, toDate, applyFilter]);

  const firstHalf  = filtered.slice(0,Math.floor(filtered.length/2)).reduce((s,d)=>s+d.attendance,0)/(Math.floor(filtered.length/2)||1);
  const secondHalf = filtered.slice(Math.floor(filtered.length/2)).reduce((s,d)=>s+d.attendance,0)/(Math.ceil(filtered.length/2)||1);
  const trend      = firstHalf>0?Math.round(((secondHalf-firstHalf)/firstHalf)*100):0;

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: BG }}>
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0 overflow-auto">
        <div className="px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderBottom:`1px solid ${BORDER}`, background:CARD_BG }}>
          <div>
            <h1 className="text-lg font-bold text-white">Analytics</h1>
            <p className="text-xs mt-0.5" style={{ color:"#6b7280" }}>
              Attendance trends and seat utilisation
              {hydrated && realDemo && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]" style={{ background:"var(--border-subtle)", color:"#6366f1" }}>Live · updates every 5s</span>}
              {hydrated && edge && updatedAt && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]" style={{ background:"var(--border-subtle)", color:"#6366f1" }}>Live · updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
            </p>
          </div>
          {edge ? (
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <span className="text-xs text-gray-500 shrink-0">Camera</span>
              <select value={edgeCamera} onChange={(e) => { setLoading(true); setEdgeCamera(e.target.value); }}
                className="min-w-0 max-w-full flex-1 sm:flex-none bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All cameras</option>
                {cameras.map((c) => (
                  <option key={c.camera_id} value={c.camera_id}>{c.zone_name || c.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <CameraSwitcher activeCameraId={cameraId} onChange={setCameraId} />
          )}
        </div>

        {/* Search bar */}
        <form onSubmit={(e)=>{ e.preventDefault(); applyFilter(history,search,fromDate,toDate); }}
          className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
          style={{ borderBottom:`1px solid ${BORDER}`, background:"var(--bg-base)" }}>
          <div className="flex items-center gap-2 flex-1 min-w-48 rounded-lg px-3 py-2" style={{ background:CARD_BG, border:`1px solid ${BORDER}` }}>
            <Search size={13} style={{ color:"#6b7280" }}/>
            <input type="text" placeholder="Search by day name (e.g. Sunday) or year…"
              value={search} onChange={(e)=>{ setSearch(e.target.value); applyFilter(history,e.target.value,fromDate,toDate); }}
              className="flex-1 bg-transparent text-xs text-white focus:outline-none placeholder-gray-600"/>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color:"#6b7280" }}>From</label>
            <DatePicker value={fromDate} onChange={(v)=>{ setFromDate(v); if(v){const m=history.find((d)=>d.timestamp.startsWith(v));if(m)setSelectedDay(m);} }} placeholder="Start date"/>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color:"#6b7280" }}>To</label>
            <DatePicker value={toDate} onChange={(v)=>{ setToDate(v); if(v){const m=history.find((d)=>d.timestamp.startsWith(v));if(m)setSelectedDay(m);} }} placeholder="End date"/>
          </div>
          <button type="submit" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white" style={{ background:"#4f46e5" }}>
            <Search size={12}/> Search
          </button>
          {(search||fromDate||toDate) && (
            <button type="button" onClick={()=>{ setSearch(""); setFromDate(""); setToDate(""); }}
              className="text-xs px-3 py-2 rounded-lg" style={{ background:"var(--border-subtle)", color:"#9ca3af" }}>Clear</button>
          )}
          {filtered.length !== history.length && (
            <span className="text-xs" style={{ color:"#6366f1" }}>Showing {filtered.length} of {history.length} days</span>
          )}
        </form>

        <div className="p-6 flex flex-col gap-5">
          {loading && <div className="text-sm py-16 text-center" style={{ color:"#6b7280" }}>Loading…</div>}
          {!loading && edge && edgeError && (
            <p className="text-xs" style={{ color:"#f87171" }}>Couldn&apos;t load the latest counts ({edgeError}). Trying again in a minute.</p>
          )}
          {!loading && edge && !edgeError && history.length === 0 && (
            <div className="rounded-2xl p-8 text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
              <BarChart2 size={22} className="mx-auto mb-3" style={{ color:"#6366f1" }}/>
              <p className="text-sm font-semibold text-white">No counts yet</p>
              <p className="text-xs mt-1.5 max-w-sm mx-auto" style={{ color:"#6b7280" }}>
                Counts appear here after a service with Camera Mode or a camera computer running.
              </p>
            </div>
          )}
          {!loading && !(edge && history.length === 0) && <>
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat label="Total services" value={summary.total_sessions} sub={edge ? `Last ${EDGE_DAYS} days` : "Last 6 months"} icon={Calendar} accent="#6366f1"/>
                <Stat label={edge ? "Busiest day" : "All-time peak"}
                  value={((summary as { busiest_day?: number }).busiest_day ?? summary.all_time_peak).toLocaleString()}
                  sub={edge
                    ? `${(summary as { attendance_from_register?: boolean }).attendance_from_register ? "Most different people on one day" : "Most who came in on one day"} · ${summary.all_time_peak.toLocaleString()} seen at once`
                    : "Single service record"}
                  icon={TrendingUp} accent="#f59e0b"/>
                <Stat label="Average attendance" value={Math.round(summary.avg_attendance).toLocaleString()}
                  sub={trend!==0?`${trend>0?"↑":"↓"} ${Math.abs(trend)}% vs prior period`:"Stable"} icon={Users} accent="#4ade80"/>
                <Stat label="Avg occupancy" value={`${summary.avg_occupancy_pct}%`} sub="Of seat capacity" icon={BarChart2} accent="#818cf8"/>
              </div>
            )}
            {/* Where these numbers come from. A camera on the door answers
                "how many are in the building" far better than a camera on the
                room, which can only report its own corner of a wide hall — and
                until now Analytics used the room's view while the live page
                used the door's, so the two disagreed. */}
            {summary && (
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                {(summary as { attendance_from_register?: boolean }).attendance_from_register
                  ? <><strong style={{ color: "var(--text-secondary)" }}>Attendance is how many different people were there</strong>, counted once
                      each, however often they stood up, moved seats or stepped out. No camera sees a whole hall, so
                      &quot;seen at once&quot; is always the smaller number and is never the attendance.</>
                  : (summary as { attendance_is_arrivals?: boolean }).attendance_is_arrivals
                  ? <><strong style={{ color: "var(--text-secondary)" }}>These days are from before Kyro kept a register of people</strong>, so attendance
                      here is the cameras&apos; own tally of people walking in. A camera watching a room counts every person it
                      becomes sure of, so on a long afternoon it counts the same congregation more than once. Days from now on
                      count each person once.</>
                  : <>No camera counted anyone in or out on these days, so attendance falls back to the most the cameras saw at
                      once. That is a floor, not an answer — a camera sees its own corner of a room.</>}
                {summary.avg_occupancy_pct === 0 && " Occupancy stays at 0% until the rooms have their number of seats set, on the Cameras page."}
              </p>
            )}
            {selectedDay && (
              <DayDetail point={selectedDay} allData={history} onClose={()=>setSelectedDay(null)}/>
            )}
            <TrendChart data={filtered}/>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ArrivalChart data={arrival} movementDays={(summary as { movement_days?: number } | null)?.movement_days}
                fromRegister={(summary as { movement_from_register?: boolean } | null)?.movement_from_register}
                byDayDates={[...history].reverse().map((h) => h.timestamp.slice(0, 10))}/>
              <WeeklyBreakdown data={filtered}/>
            </div>
            <RecentSessions data={filtered} onSelect={setSelectedDay} selectedTs={selectedDay?.timestamp}
              canDelete={edge && role === "admin"}
              onDeleted={() => { setDeletedTick((n) => n + 1); loadData(); }} />
            {edge && role === "admin" && (
              <DeletedServices reload={deletedTick} onRestored={() => { setDeletedTick((n) => n + 1); loadData(); }} />
            )}
          </>}
        </div>
      </main>
    </div>
  );
}
