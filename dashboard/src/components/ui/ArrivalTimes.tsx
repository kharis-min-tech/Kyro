"use client";

/**
 * ArrivalTimes — "when do people arrive and leave?" for one day.
 *
 * Mirrored bars on ONE shared count axis: arrivals rise above the
 * baseline, departures hang below it, one column per time slot. The
 * busiest arrival and exit slots are labelled directly; every slot has a
 * hover tooltip, and a table view lists every value (so nothing is
 * tooltip-only or colour-only).
 *
 * Colours are --series-arrive / --series-leave from globals.css (blue /
 * orange, validated for colour-blind separation on both themes).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Table2, BarChart3 } from "lucide-react";
import { bucketArrivals, type CounterPoint, type Slot } from "@/lib/arrivals";

const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";
const ARRIVE = "var(--series-arrive)";
const LEAVE  = "var(--series-leave)";

const SLOT_CHOICES = [15, 30, 60] as const;
type SlotMinutes = typeof SLOT_CHOICES[number];

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
/** "9:45 – 10:00 AM", or "11:45 AM – 12:00 PM" when the range crosses noon. */
function fmtRange(s: Slot, minutes: number): string {
  const a = fmtTime(s.start), b = fmtTime(s.start + minutes * 60_000);
  const ma = a.slice(-2), mb = b.slice(-2);
  return ma === mb ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
/** Short axis label: "9:45" on the quarter, "10 AM" on the hour. */
function axisLabel(t: number): string {
  const d = new Date(t);
  return d.getMinutes() === 0
    ? d.toLocaleTimeString("en-US", { hour: "numeric" })
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/ (AM|PM)$/, "");
}
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => v <= n * mag) ?? 10;
  return step * mag;
}

function StatTile({ label, value, sub, swatch }: { label: string; value: string; sub?: string; swatch?: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
      <p className="flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {swatch && <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: swatch }} />}
        {label}
      </p>
      <p className="font-semibold" style={{ fontSize: 15, color: "var(--text-primary)", marginTop: 2 }}>{value}</p>
      {sub && <p className="truncate" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{sub}</p>}
    </div>
  );
}

export function ArrivalTimes({ series, emptyMessage, isSample }: {
  /** One cumulative counter series per camera. */
  series: CounterPoint[][] | null;
  /** Shown when there is nothing to chart (no cameras / no data that day). */
  emptyMessage: string;
  /** Demo data — labelled so nobody mistakes it for real numbers. */
  isSample?: boolean;
}) {
  const [minutes, setMinutes] = useState<SlotMinutes>(15);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  // Columns stretch to fill the card; on narrow screens they keep a
  // minimum width and the chart scrolls sideways instead.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWrapW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const summary = useMemo(() => bucketArrivals(series ?? [], minutes), [series, minutes]);
  const { slots, peakArrival, peakDeparture } = summary;
  const hasData = slots.length > 0;

  // ── Geometry ──
  const padL = 40, padR = 8, padT = 22, padB = 22, axisH = 22;
  const minColW = minutes === 15 ? 18 : minutes === 30 ? 28 : 44;
  const fitColW = slots.length ? (wrapW - padL - padR) / slots.length : 0;
  const colW = Math.min(64, Math.max(minColW, fitColW));
  const gap = 2;
  const half = 92;                                   // px per side of the baseline
  const plotW = Math.max(slots.length * colW, 240);
  const width = padL + plotW + padR;
  const height = padT + half * 2 + padB + axisH;
  const baseY = padT + half;
  const yMax = niceMax(Math.max(1, ...slots.map((s) => Math.max(s.arrived, s.left))));
  const scale = (v: number) => (v / yMax) * half;
  const labelEvery = minutes === 15 ? 4 : minutes === 30 ? 2 : 1; // ≈ one label per hour

  const hovered = hover !== null ? slots[hover] : null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      {/* Header + controls (one row, above the chart) */}
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <Clock size={14} /> Arrival &amp; exit times
            {isSample && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}>Sample data</span>
            )}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            How many people came in and went out in each {minutes === 60 ? "hour" : `${minutes} minutes`}
          </p>
        </div>
        {hasData && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }} role="group" aria-label="Slot size">
              {SLOT_CHOICES.map((m) => (
                <button key={m} onClick={() => { setMinutes(m); setHover(null); }}
                  aria-pressed={minutes === m}
                  className="px-2.5 py-1 rounded-md text-xs font-medium"
                  style={minutes === m
                    ? { background: "var(--bg-hover)", color: "var(--text-primary)" }
                    : { color: "var(--text-muted)" }}>
                  {m === 60 ? "1 hr" : `${m} min`}
                </button>
              ))}
            </div>
            <button onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-tertiary)" }}>
              {view === "chart" ? <><Table2 size={12} /> Table</> : <><BarChart3 size={12} /> Chart</>}
            </button>
          </div>
        )}
      </div>

      {!hasData ? (
        <p className="px-5 py-8 text-center" style={{ fontSize: 13, color: "var(--text-faint)" }}>{emptyMessage}</p>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          {/* Headline answers */}
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <StatTile label="Busiest arrival time" swatch={ARRIVE}
              value={peakArrival ? fmtRange(peakArrival, minutes) : "—"}
              sub={peakArrival ? `${peakArrival.arrived.toLocaleString()} people arrived` : undefined} />
            <StatTile label="Busiest exit time" swatch={LEAVE}
              value={peakDeparture ? fmtRange(peakDeparture, minutes) : "—"}
              sub={peakDeparture ? `${peakDeparture.left.toLocaleString()} people left` : undefined} />
            <StatTile label="Half had arrived by"
              value={summary.halfArrivedBy ? fmtTime(summary.halfArrivedBy) : "—"}
              sub={`${summary.totalArrived.toLocaleString()} arrivals in total`} />
            <StatTile label="First arrivals"
              value={summary.firstArrival ? fmtTime(summary.firstArrival) : "—"}
              sub={`${summary.totalLeft.toLocaleString()} exits in total`} />
          </div>

          {view === "table" ? (
            <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "var(--bg-inset)", color: "var(--text-muted)", fontSize: 12 }}>
                    <th className="text-left font-medium px-3 py-2">Time</th>
                    <th className="text-right font-medium px-3 py-2">Arrived</th>
                    <th className="text-right font-medium px-3 py-2">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.start} style={{ borderTop: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtRange(s, minutes)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.arrived.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{s.left.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ARRIVE }} /> Arrived (above the line)</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: LEAVE }} /> Left (below the line)</span>
              </div>

              {/* Readout for the hovered / tapped slot — sits above the plot
                 so it never covers the bars it describes. */}
              <p aria-live="polite" style={{ fontSize: 12, minHeight: 18, color: hovered ? "var(--text-secondary)" : "var(--text-faint)" }}>
                {hovered ? (
                  <>
                    <strong style={{ color: "var(--text-primary)" }}>{fmtRange(hovered, minutes)}</strong>
                    {" · "}{hovered.arrived.toLocaleString()} arrived · {hovered.left.toLocaleString()} left
                  </>
                ) : "Hover or tap a bar to see its numbers"}
              </p>

              <div ref={wrapRef} className="relative overflow-x-auto" onMouseLeave={() => setHover(null)}>
                <svg width={width} height={height} role="img"
                  aria-label={`Arrivals and exits per ${minutes} minutes. Busiest arrival ${peakArrival ? fmtRange(peakArrival, minutes) : "none"}.`}
                  style={{ display: "block", minWidth: width }}>
                  {/* Grid: baseline + max lines, recessive */}
                  {[-1, -0.5, 0.5, 1].map((f) => (
                    <line key={f} x1={padL} x2={padL + plotW} y1={baseY - f * half} y2={baseY - f * half}
                      stroke="var(--border-subtle)" strokeWidth={1} />
                  ))}
                  {[1, 0.5, -0.5, -1].map((f) => (
                    <text key={f} x={padL - 6} y={baseY - f * half + 3} textAnchor="end"
                      style={{ fontSize: 10, fill: "var(--text-muted)" }}>
                      {Math.round(Math.abs(f) * yMax).toLocaleString()}
                    </text>
                  ))}

                  {slots.map((s, i) => {
                    const x = padL + i * colW + gap / 2;
                    const w = colW - gap;
                    const hIn = scale(s.arrived), hOut = scale(s.left);
                    const r = Math.min(4, w / 2);
                    const dim = hover !== null && hover !== i;
                    return (
                      <g key={s.start} opacity={dim ? 0.45 : 1}>
                        {/* Arrivals: rounded top, square at the baseline */}
                        {hIn > 0 && (
                          <path d={`M${x},${baseY - 1} V${baseY - hIn + r} Q${x},${baseY - hIn} ${x + r},${baseY - hIn} H${x + w - r} Q${x + w},${baseY - hIn} ${x + w},${baseY - hIn + r} V${baseY - 1} Z`}
                            fill={ARRIVE} />
                        )}
                        {/* Departures: rounded bottom */}
                        {hOut > 0 && (
                          <path d={`M${x},${baseY + 1} V${baseY + hOut - r} Q${x},${baseY + hOut} ${x + r},${baseY + hOut} H${x + w - r} Q${x + w},${baseY + hOut} ${x + w},${baseY + hOut - r} V${baseY + 1} Z`}
                            fill={LEAVE} />
                        )}
                        {/* Direct labels on the two peaks only */}
                        {s === peakArrival && (
                          <text x={x + w / 2} y={baseY - hIn - 6} textAnchor="middle"
                            style={{ fontSize: 11, fontWeight: 600, fill: "var(--text-primary)" }}>{s.arrived.toLocaleString()}</text>
                        )}
                        {s === peakDeparture && (
                          <text x={x + w / 2} y={baseY + hOut + 13} textAnchor="middle"
                            style={{ fontSize: 11, fontWeight: 600, fill: "var(--text-primary)" }}>{s.left.toLocaleString()}</text>
                        )}
                        {/* X labels ≈ hourly */}
                        {i % labelEvery === 0 && (
                          <text x={x} y={height - 6} style={{ fontSize: 10, fill: "var(--text-muted)" }}>{axisLabel(s.start)}</text>
                        )}
                        {/* Full-column hit target, bigger than the bars */}
                        <rect x={padL + i * colW} y={padT - 16} width={colW} height={half * 2 + 32} fill="transparent"
                          onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                      </g>
                    );
                  })}
                  <line x1={padL} x2={padL + plotW} y1={baseY} y2={baseY} stroke="var(--text-faint)" strokeWidth={1} />
                </svg>

              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
