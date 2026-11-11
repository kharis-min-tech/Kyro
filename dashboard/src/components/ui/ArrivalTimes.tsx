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
import { Clock, Table2, BarChart3, AlertTriangle, RotateCcw, Download } from "lucide-react";
import { bucketArrivals, bucketPeople, sinceFreshStart, type CounterPoint, type PeopleMovement, type Slot } from "@/lib/arrivals";

const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";
const ARRIVE = "var(--series-arrive)";
const LEAVE  = "var(--series-leave)";

const SLOT_CHOICES = [15, 30, 60, 120, 180, 240] as const;
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
      {/* Wrapped, not truncated. "281 more came in than ..." tells the reader
          nothing except that something was hidden from them. */}
      {sub && <p style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.35 }}>{sub}</p>}
    </div>
  );
}

export function ArrivalTimes({ series, unverifiedSeries, emptyMessage, isSample, sessionFrom, onFreshStart, byCamera, onDownload, doorMode, onDoorMode, doorModeBy, movement, overSeats }: {
  /** One cumulative counter series per camera. */
  series: CounterPoint[][] | null;
  /**
   * The same, including readings Kyro won't stand behind — the figures from
   * before it counted people at a door by the direction they walked, when
   * anyone appearing counted as arriving and anyone disappearing as leaving.
   * Nothing is ever deleted, so these can be looked at; they are only ever
   * shown behind a switch, under a label saying what they are.
   */
  unverifiedSeries?: CounterPoint[][] | null;
  /** Shown when there is nothing to chart (no cameras / no data that day). */
  emptyMessage: string;
  /** Demo data — labelled so nobody mistakes it for real numbers. */
  isSample?: boolean;
  /**
   * When this session's counting began (epoch ms), if someone asked for a
   * fresh start. The card then shows this session by itself, and offers the
   * whole day beside it — nothing is deleted by starting fresh.
   */
  sessionFrom?: number | null;
  /** Start the figures again from zero, for a new session. Omit to hide the button. */
  onFreshStart?: (forgetPeople?: boolean) => Promise<void> | void;
  /**
   * What each camera counted on its own, so one camera's figure never stands
   * in for the building's without saying so. On an afternoon with about 900
   * people in, the room camera said 843 and the doorway camera said 106 —
   * which is the single most useful thing this card can show.
   */
  byCamera?: { name: string; where: string; points: CounterPoint[]; pointsAll: CounterPoint[] }[];
  /**
   * Every reading behind these figures, for downloading. A number on a screen
   * that can change when somebody changes the software is not something a
   * church can keep; a file on their own computer is.
   */
  onDownload?: () => void;
  /**
   * What the doorway cameras have been told: "auto" to work out each person's
   * direction, or that everybody crossing right now is arriving / leaving.
   */
  doorMode?: "auto" | "in" | "out";
  onDoorMode?: (mode: "auto" | "in" | "out") => Promise<void> | void;
  /** Who said so, for the line that says it is still on. */
  doorModeBy?: string;
  /** Different people seen this service, counted once each. */
  /**
   * Arrivals and departures as the register of people counts them — once each
   * — in quarter-hour slots. When this is here it is what the card shows,
   * because everything else on it counts crossings: a camera on a room has no
   * doorway to watch, so one person who steps out and comes back is another
   * arrival, every time.
   */
  movement?: PeopleMovement | null;
  /**
   * More different people counted this service than the room has seats, when
   * that has happened and hardly anybody has left — the one check on this
   * count that comes from a fact about the building rather than from the
   * thing being checked. See attendance_over_seats in worker/venue.js.
   */
  overSeats?: { seats: number; counted: number; left: number } | null;
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

  const [unverified, setUnverified] = useState(false);
  const extra = (unverifiedSeries?.length ?? 0) - (series?.length ?? 0);
  const canShowUnverified = !!unverifiedSeries && (extra > 0 || unverifiedSeries.some((p, i) => p.length !== (series?.[i]?.length ?? 0)));
  const picked = unverified && unverifiedSeries ? unverifiedSeries : series;
  // This session, or the whole day. A fresh start keeps every reading, so both
  // are always available; "this session" is simply the default once one has
  // been asked for.
  const [wholeDay, setWholeDay] = useState(false);
  const [freshing, setFreshing] = useState(false);
  const [freshAsking, setFreshAsking] = useState(false);
  const [freshErr, setFreshErr] = useState<string | null>(null);
  const showingSession = !!sessionFrom && !wholeDay;
  const shown = useMemo(
    () => (showingSession ? sinceFreshStart(picked ?? [], sessionFrom!) : picked),
    [picked, showingSession, sessionFrom],
  );
  // The register's figures when there are any, and the cameras' tallies only
  // when there are not. Switching to the unverified readings is a deliberate
  // request to see the tallies, so it wins.
  const usingRegister = !!movement && movement.arrived.length > 0 && !unverified;
  const summary = useMemo(
    () => (usingRegister
      ? bucketPeople(movement!, minutes, showingSession ? sessionFrom : null)
      : bucketArrivals(shown ?? [], minutes)),
    [usingRegister, movement, shown, minutes, showingSession, sessionFrom],
  );
  // Each camera's figures, worked out exactly as the totals above are: same
  // stretch of the day, same choice about unverified readings. They were
  // computed separately before, over the whole day and including readings the
  // totals leave out — so the tile said 1,206 and the table said 1,881 for the
  // same camera on the same card. A breakdown that doesn't add up to the thing
  // it breaks down is worse than no breakdown.
  const cameraTotals = useMemo(() => (byCamera ?? []).map((c) => {
    const pts = unverified ? c.pointsAll : c.points;
    const windowed = showingSession ? sinceFreshStart([pts], sessionFrom!) : [pts];
    const sum = bucketArrivals(windowed, minutes);
    return { name: c.name, where: c.where, arrived: sum.totalArrived, left: sum.totalLeft };
  }).sort((a, b) => b.arrived - a.arrived), [byCamera, unverified, showingSession, sessionFrom, minutes]);
  const { slots, peakArrival, peakDeparture } = summary;
  const hasData = slots.length > 0;

  // ── Geometry ──
  const padL = 40, padR = 8, padT = 22, padB = 22, axisH = 22;
  const minColW = minutes === 15 ? 18 : minutes === 30 ? 28 : minutes === 60 ? 44 : 64;
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
  // About one label per hour at the fine sizes; every bar once a bar is an
  // hour or more, or the axis would be mostly blank.
  const labelEvery = minutes === 15 ? 4 : minutes === 30 ? 2 : 1;

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
            How many people came in and went out in each {minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "hour" : `${minutes / 60} hours`}
          </p>
          {/* Which of the two things on this card is being shown — in four
              words rather than three sentences. They can be very far apart
              (one person at a desk counted as eleven), so it still has to be
              said; it does not have to be explained every time. */}
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3 }}
            title={usingRegister
              ? "From the register of people: each person counted once, however often a camera becomes sure of them again."
              : "From the cameras' own tallies, which count crossings rather than people — somebody who steps out and comes back counts again. The register takes over once a service is running."}>
            {usingRegister ? "Each person counted once" : "Camera tallies — crossings, not people"}
          </p>
          {/* Which stretch of the day these figures cover. Said out loud, so a
              session's figures are never mistaken for the day's. */}
          {sessionFrom && (
            <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
              {showingSession
                ? <>This session only, counting from <strong style={{ color: "var(--text-secondary)" }}>{fmtTime(sessionFrom)}</strong>. Nothing was deleted.</>
                : <>The whole day, including before this session started at {fmtTime(sessionFrom)}.</>}
              {" "}
              <button type="button" onClick={() => { setWholeDay((v) => !v); setHover(null); }}
                className="underline" style={{ color: "var(--text-secondary)" }}>
                {showingSession ? "Show the whole day" : "Show this session only"}
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Always here, data or not: the moment to press it is at the start of
              a session, when there is nothing to show yet. */}
          {onFreshStart && (
            <button type="button" disabled={freshing || freshAsking}
              onClick={() => { setFreshAsking(true); setFreshErr(null); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60"
              style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}
              title="The arrivals and departures start again from zero for a new session. Every reading is kept.">
              <RotateCcw size={12} /> {freshing ? "Starting fresh…" : "Start fresh"}
            </button>
          )}
          {onDownload && (
            <button type="button" onClick={onDownload}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}
              title="Every reading behind these figures, camera by camera, as a spreadsheet file you keep.">
              <Download size={12} /> Save the numbers
            </button>
          )}
          {hasData && (
            <>
            <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }} role="group" aria-label="Slot size">
              {SLOT_CHOICES.map((m) => (
                <button key={m} onClick={() => { setMinutes(m); setHover(null); }}
                  aria-pressed={minutes === m}
                  className="px-2.5 py-1 rounded-md text-xs font-medium"
                  style={minutes === m
                    ? { background: "var(--bg-hover)", color: "var(--text-primary)" }
                    : { color: "var(--text-muted)" }}>
                  {m < 60 ? `${m} min` : `${m / 60} hr`}
                </button>
              ))}
            </div>
            {canShowUnverified && (
              <button type="button" onClick={() => { setUnverified((v) => !v); setHover(null); }}
                aria-pressed={unverified}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={unverified
                  ? { background: "rgba(245,158,11,0.15)", color: "#b45309", border: "1px solid rgba(245,158,11,0.5)" }
                  : { background: "var(--bg-inset)", color: "var(--text-muted)", border: `1px solid ${BORDER}` }}>
                {unverified ? "Showing unverified" : "Show unverified"}
              </button>
            )}
            <button onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-tertiary)" }}>
              {view === "chart" ? <><Table2 size={12} /> Table</> : <><BarChart3 size={12} /> Chart</>}
            </button>
            </>
          )}
        </div>
        {freshAsking && (
          /* Asked here rather than in one of the browser's own boxes: those
             appear for reloads too, can't say why they are asking, and teach
             people to click through warnings without reading them. */
          <div className="w-full rounded-xl px-3 py-2.5 flex flex-col gap-2"
            style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              Start the came in / went out figures from zero?
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              For a new session. <strong>Nothing is deleted</strong> — everything counted so far is kept, this card
              shows the new session on its own, and <em>Show the whole day</em> brings the rest back whenever you want it.
              The counting computer starts its tally again within a few seconds; people already in the room stay counted
              as being there.
            </p>
            {/* And the stronger one: when Kyro has got the register wrong —
                somebody counted four times, a coat on a chair counted as a
                person — there has to be a way to say so and begin again,
                rather than waiting for the service to end. Nothing is
                destroyed by it either; the record is put aside for 30 days,
                the same as a deleted day. */}
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              If the <strong>people</strong> are wrong too — Kyro counted the same person more than once, or counted
              something that isn&apos;t a person — the second button below also puts
              <em> different people, this service</em> back to nobody and starts the register again. That record is put
              aside for 30 days rather than destroyed.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={freshing}
                onClick={async () => {
                  setFreshing(true); setFreshErr(null);
                  try { await onFreshStart!(false); setWholeDay(false); setFreshAsking(false); }
                  catch (e) { setFreshErr(e instanceof Error ? e.message : "Couldn't start fresh just now"); }
                  setFreshing(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                style={{ background: "#4f46e5" }}>
                {freshing ? "Starting fresh…" : "Yes, start fresh"}
              </button>
              <button type="button" disabled={freshing}
                onClick={async () => {
                  setFreshing(true); setFreshErr(null);
                  try { await onFreshStart!(true); setWholeDay(false); setFreshAsking(false); }
                  catch (e) { setFreshErr(e instanceof Error ? e.message : "Couldn't start fresh just now"); }
                  setFreshing(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60"
                style={{ background: "rgba(249,115,22,0.15)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.4)" }}>
                {freshing ? "Starting again…" : "Start again from nobody"}
              </button>
              <button type="button" onClick={() => setFreshAsking(false)} disabled={freshing}
                className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60"
                style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {freshErr && <p className="w-full" style={{ fontSize: 12, color: "#b45309" }}>{freshErr}</p>}
      </div>

      {/* "Everybody is leaving now."
          Kyro normally works out which way each person went by watching them
          move, which needs two clear sightings — and a crowded door at the end
          of a service is the hardest moment to get that right. At that moment
          the church already knows the answer, so it can simply say so. */}
      {onDoorMode && (
        <div className="px-5 py-3 flex flex-col gap-2" style={{ borderBottom: `1px solid ${BORDER}`,
          background: doorMode && doorMode !== "auto" ? "rgba(79,70,229,0.07)" : undefined }}>
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>At the entrance, right now:</span>
            <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }} role="group">
              {([
                ["auto", "Work it out"],
                ["in", "Everyone is arriving"],
                ["out", "Everyone is leaving"],
              ] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => onDoorMode(m)} aria-pressed={(doorMode ?? "auto") === m}
                  className="px-2.5 py-1 rounded-md text-xs font-medium"
                  style={(doorMode ?? "auto") === m
                    ? { background: m === "auto" ? "var(--bg-hover)" : "#4f46e5", color: m === "auto" ? "var(--text-primary)" : "#fff" }
                    : { color: "var(--text-muted)" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.45 }}>
            {doorMode === "out"
              ? <><strong style={{ color: "var(--text-secondary)" }}>Counting everyone at the entrance as leaving.</strong> Every person
                 the camera is sure of is counted out, without having to work out which way they walked — which is what it struggles
                 with in a crowd. Anyone walking back IN is counted as leaving too, so put this back to
                 &quot;Work it out&quot; once the hall has emptied{doorModeBy ? ` (turned on by ${doorModeBy})` : ""}.</>
              : doorMode === "in"
              ? <><strong style={{ color: "var(--text-secondary)" }}>Counting everyone at the entrance as arriving.</strong> For the
                 doors opening, when everybody is coming the same way. Anyone going OUT is counted as arriving too, so put this
                 back to &quot;Work it out&quot; once people are settled{doorModeBy ? ` (turned on by ${doorModeBy})` : ""}.</>
              : <>Kyro works out which way each person went by watching them move across the doorway. In a crush that is the hardest
                 thing to get right — so when everybody is going the same way, say so, and it counts them that way instead of guessing.</>}
          </p>
        </div>
      )}

      {!hasData ? (
        <p className="px-5 py-8 text-center" style={{ fontSize: 13, color: "var(--text-faint)" }}>
          {showingSession
            ? `Nobody counted in or out since this session started at ${fmtTime(sessionFrom!)}. New arrivals appear here within a minute or two.`
            : emptyMessage}
        </p>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          {unverified && (
            <div className="rounded-xl px-3 py-2.5 flex items-start gap-2"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.45)" }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "#b45309" }} />
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                <strong>These figures are not counts of people.</strong> They include readings from
                before Kyro counted at a doorway by the direction people walked, when anyone appearing
                counted as arriving and anyone disappearing as leaving — so everyone passing a door was
                counted both ways, and arrivals climbed while rooms emptied. They are shown because
                nothing is ever deleted, not because they are right. The attendance counts are
                unaffected, and were always measured properly.
              </p>
            </div>
          )}

          {/* The room's own answer, against the count. A hall with 114 seats
              did not hold 117 different people in a morning when three of
              them have left. */}
          {overSeats && usingRegister && (
            <div className="rounded-xl px-3 py-2.5 flex items-start gap-2"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.45)" }}>
              <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "#b45309" }} />
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                <strong>More people counted than the room holds.</strong> You have told Kyro
                there are {overSeats.seats.toLocaleString()} seats. It has counted{" "}
                {overSeats.counted.toLocaleString()} different people and recorded{" "}
                {overSeats.left.toLocaleString()} of them leaving, so at least{" "}
                {Math.max(1, overSeats.counted - overSeats.left - overSeats.seats).toLocaleString()}{" "}
                of them had nowhere to sit. Either people are standing, or somebody has been
                counted twice — most often somebody the camera lost for a moment and found
                again. The figure is shown as it was measured, not quietly corrected.
              </p>
            </div>
          )}

          {/* Headline answers */}
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {/* The day's two totals, first and plainly labelled. They were
                here before, as small print under "Half had arrived by" and
                "First arrivals" — which is no place for the number most people
                open this card to find. */}
            {/* A tile counting the register's people used to lead this row.
                Removed at the church's request: it repeated the attendance
                headline further up the same page, so when the register was
                wrong it was wrong twice, in two places, with nothing to say
                which to believe. Attendance still comes from the register —
                it is the same number, said once, where people look for it. */}
            <StatTile label={`${showingSession ? "Came in, this session" : "Came in, all day"}${unverified ? " (unverified)" : ""}`} swatch={ARRIVE}
              value={summary.totalArrived.toLocaleString()}
              sub={usingRegister
                ? "Different people, counted once each"
                : `${Math.max(0, summary.totalArrived - summary.totalLeft).toLocaleString()} more came in than went out`} />
            <StatTile label={`${showingSession ? "Went out, this session" : "Went out, all day"}${unverified ? " (unverified)" : ""}`} swatch={LEAVE}
              value={summary.totalLeft.toLocaleString()}
              sub={usingRegister
                ? "People nobody has seen for five minutes"
                : summary.totalArrived ? `${Math.round((summary.totalLeft / summary.totalArrived) * 100)}% of those who came in` : undefined} />
            <StatTile label="Busiest arrival time" swatch={ARRIVE}
              value={peakArrival ? fmtRange(peakArrival, minutes) : "—"}
              sub={peakArrival ? `${peakArrival.arrived.toLocaleString()} ${peakArrival.arrived === 1 ? "person" : "people"} arrived` : undefined} />
            <StatTile label="Busiest exit time" swatch={LEAVE}
              value={peakDeparture ? fmtRange(peakDeparture, minutes) : "—"}
              sub={peakDeparture ? `${peakDeparture.left.toLocaleString()} ${peakDeparture.left === 1 ? "person" : "people"} left` : undefined} />
            <StatTile label="Half had arrived by"
              value={summary.halfArrivedBy ? fmtTime(summary.halfArrivedBy) : "—"}
              sub={summary.firstArrival ? `first at ${fmtTime(summary.firstArrival)}` : undefined} />
          </div>

          {/* Camera by camera. Whichever total is right, both are here. */}
          {cameraTotals.length > 1 && (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              <p className="px-3 py-2" style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-inset)" }}>
                What each camera counted on its own, over the same stretch as the figures above. Only the entrance camera's
                count is used in the figures: a room camera counts people it becomes sure of, which rises all through a
                service and counts the same people again and again. Its numbers are kept here because they are yours, not
                because they are arrivals.
              </p>
              <table className="w-full" style={{ fontSize: 13 }}>
                <tbody>
                  {cameraTotals.map((c) => (
                    <tr key={c.name} style={{ borderTop: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
                      <td className="px-3 py-1.5">
                        {c.name}
                        <span style={{ color: "var(--text-faint)", fontSize: 11 }}> · {c.where}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: ARRIVE }}>{c.arrived.toLocaleString()} in</td>
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: LEAVE }}>{c.left.toLocaleString()} out</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
