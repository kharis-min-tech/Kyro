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

function StatTile({ label, value, sub, swatch, action, note }: {
  label: string; value: string; sub?: string; swatch?: string;
  /** Something true about this figure that the reader cannot act on here. */
  note?: string;
  /**
   * Something to do about this figure, under the figure itself.
   *
   * "i still cant see 114 ... it says 237, this is false." The one thing
   * that fixes that number was a panel further up the same card, and she
   * never found it. A fix the reader cannot see from the mistake may as
   * well not exist, so it goes under the mistake.
   */
  action?: { label: string; onClick: () => void };
}) {
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
      {note && (
        <p className="mt-1" style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>{note}</p>
      )}
      {action && (
        <button type="button" onClick={action.onClick}
          className="underline mt-1 text-left"
          style={{ fontSize: 11, color: "var(--brand-gold, #b7791f)", lineHeight: 1.35 }}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ArrivalTimes({ series, unverifiedSeries, emptyMessage, isSample, sessionFrom, onFreshStart, byCamera, onDownload, doorMode, onDoorMode, doorModeBy, movement, overSeats, seats, onSetSeats, attendance, seenAtOnce, seatsFound }: {
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
  /**
   * How many seats this building has, as somebody entered it — 0 or null
   * when nobody has. Without it the attendance figure has nothing to answer
   * to, which is how a hall of 114 chairs came to report 208 people.
   */
  seats?: number | null;
  /** Write a new seat count, from here. See the note on the field below. */
  onSetSeats?: (n: number) => Promise<void>;
  /**
   * How many seats Kyro has found by itself, when nobody has entered one.
   * Offered rather than used: Kyro does the counting, one press makes it the
   * answer. See seats_found in worker/venue.js.
   */
  seatsFound?: number | null;
  /**
   * How many DIFFERENT people Kyro has counted this service — the attendance
   * figure, from the doorway if one is counting and from the rooms if not.
   * The same number every other page shows. See people_seen in
   * worker/venue.js.
   */
  attendance?: number | null;
  /** The most the cameras saw at one moment: a floor, never the answer. */
  seenAtOnce?: number | null;
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
  const [seatDraft, setSeatDraft] = useState("");
  const [savingSeats, setSavingSeats] = useState(false);
  const [seatErr, setSeatErr] = useState<string | null>(null);
  const seatBox = useRef<HTMLDivElement>(null);
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
  /**
   * The seat count, when Kyro has counted more different people than this
   * room holds — the figure to show instead of the one it measured.
   *
   * Only against the register, which counts each person once: the cameras'
   * own tallies count crossings, where passing the seat count means nothing
   * at all. And only against a seat count somebody entered — see
   * people_seen_shown in worker/venue.js for whose decision this is and what
   * is deliberately NOT changed by it.
   */
  /**
   * The figure to put under "Entries": the attendance every other page
   * shows, or the most seen at once as an honest floor — never the cameras'
   * tally of crossings, which counts one person over and over.
   */
  const attendanceShown = attendance != null && attendance > 0 ? attendance
    : usingRegister ? summary.totalArrived
    : seenAtOnce != null && seenAtOnce > 0 ? seenAtOnce
    : null;
  const held = overSeats && (usingRegister || (attendance ?? 0) > 0)
    && (attendance ?? summary.totalArrived) > overSeats.seats ? overSeats.seats : null;
  /**
   * …and what went out, held so the two still add up.
   *
   * "how is there 114 in when 274 is out, dosent make sense."
   *
   * She is right, and it was my mistake: I held the arrivals at the seat
   * count and left the departures as measured, so the card read 114 in and
   * 273 out. Two figures that contradict each other are worse than one
   * figure that is wrong, because the reader now has to work out which of
   * them to disbelieve.
   *
   * The quantity worth keeping true is the one a church actually uses: HOW
   * MANY ARE STILL HERE. Measured, that is arrivals less departures — 294
   * less 273, twenty one people still in the building — and that number is
   * not in doubt, because being seen in the last five minutes is a direct
   * observation rather than a tally of everybody ever. So the departures are
   * held at whatever keeps it: 114 came in, 93 have gone, 21 are still here.
   */
  const heldLeft = held != null
    ? Math.max(0, held - Math.max(0, summary.totalArrived - summary.totalLeft))
    : null;

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

          {/**
            * Ask for the seat count HERE, beside the figure it corrects.
            *
            * "change to 114, switch it, its innacuratre" — for the third
            * time, about a figure that had reached 208. The hold at the seat
            * count was already written, already deployed and doing nothing,
            * because it only ever fires against a seat count somebody
            * entered and nobody had. The answer she was given was "go to
            * Cameras, press the pencil, find Seat capacity" — three screens
            * away from the number that is wrong, which is three chances to
            * give up.
            *
            * A setting that the thing it fixes cannot ask for is a setting
            * nobody will find. So it is asked for where the mistake is, in
            * one field, and the sentence says what it buys.
            */}
          {usingRegister && onSetSeats && (!seats || seatDraft !== "") && (
            <div ref={seatBox} className="rounded-xl px-3 py-2.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                <strong>How many seats are in this room?</strong>{" "}
                {seats
                  ? `Kyro has ${seats.toLocaleString()}. Put the right number in and it will use that instead.`
                  : seatsFound
                  ? `Kyro has counted ${seatsFound.toLocaleString()} chairs in this room by itself. Say that is right and it becomes the seat count — or put your own number in.`
                  : "Kyro does not know, so this figure has nothing to answer to — it cannot tell a big congregation from a counting mistake. Tell it once, and anything above that is held and flagged instead of shown as fact."}
              </p>
              {/**
                * Kyro counted the chairs; one press makes that the answer.
                *
                * "its not possible, its AI, Kyro should be able to detect it
                * i dont understand." It can, and it has been — the chairs
                * come out of the same AI run that finds people. What it must
                * not do is quietly make its own count the thing everything
                * else is checked against, which is the fault she caught a
                * day earlier when 21 and 16 seats appeared out of nowhere.
                * Offering it keeps both: the AI does the work, and a person
                * says yes.
                */}
              {!seats && !!seatsFound && (
                <button type="button" disabled={savingSeats}
                  onClick={async () => {
                    setSavingSeats(true); setSeatErr(null);
                    try { await onSetSeats!(seatsFound); }
                    catch (e) { setSeatErr(e instanceof Error ? e.message : "That didn't save."); }
                    finally { setSavingSeats(false); }
                  }}
                  className="rounded-lg px-3 py-1.5 font-medium mt-2 self-start"
                  style={{ fontSize: 13, background: "#4f46e5", color: "#fff" }}>
                  {savingSeats ? "Saving…" : `Yes — use the ${seatsFound.toLocaleString()} chairs Kyro found`}
                </button>
              )}
              <div className="flex items-center gap-2 mt-2">
                {/* No number suggested. One church's seat count has no
                    business being the example every church is shown — see
                    the note on `cap` in worker/venue.js. */}
                <input type="number" min={1} max={100000} inputMode="numeric" placeholder="How many?"
                  value={seatDraft} onChange={(e) => { setSeatDraft(e.target.value); setSeatErr(null); }}
                  className="rounded-lg px-2 py-1 w-24 tabular-nums"
                  style={{ fontSize: 13, background: "var(--bg-card)", border: `1px solid ${BORDER}`, color: "var(--text-primary)" }} />
                <button type="button" disabled={savingSeats || !(Number(seatDraft) > 0)}
                  onClick={async () => {
                    const n = Math.round(Number(seatDraft));
                    if (!(n > 0)) return;
                    setSavingSeats(true); setSeatErr(null);
                    try { await onSetSeats(n); setSeatDraft(""); }
                    catch (e) { setSeatErr(e instanceof Error ? e.message : "That didn't save."); }
                    finally { setSavingSeats(false); }
                  }}
                  className="rounded-lg px-3 py-1 font-medium"
                  style={{ fontSize: 13, background: Number(seatDraft) > 0 ? "#4f46e5" : "var(--bg-card)",
                           color: Number(seatDraft) > 0 ? "#fff" : "var(--text-muted)",
                           border: `1px solid ${BORDER}`, cursor: Number(seatDraft) > 0 ? "pointer" : "default" }}>
                  {savingSeats ? "Saving…" : "Save"}
                </button>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>seats</span>
              </div>
              {seatErr && <p className="mt-1.5" style={{ fontSize: 11, color: "#dc2626" }}>{seatErr}</p>}
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
                <strong>Held at {overSeats.seats.toLocaleString()}, the number of seats in this room.</strong>{" "}
                Kyro counted {overSeats.counted.toLocaleString()} different people, which this room
                cannot hold: {overSeats.left.toLocaleString()} have been recorded leaving, so at least{" "}
                {Math.max(1, overSeats.counted - overSeats.left - overSeats.seats).toLocaleString()}{" "}
                of them had nowhere to sit. That is somebody counted twice — usually somebody the
                camera lost for a moment and found again as a stranger. Only the figure on this
                screen is held: every reading behind it is kept exactly as it was recorded, and the
                download still has all {overSeats.counted.toLocaleString()}. The figure beside it is held
                by the same amount, so the two still agree on how many are in the building.
                {onSetSeats && (
                  <> If {overSeats.seats.toLocaleString()} is not the right number of seats,{" "}
                    <button type="button" onClick={() => { setSeatDraft(String(overSeats.seats)); }}
                      className="underline" style={{ color: "var(--text-secondary)" }}>change it</button>.
                  </>
                )}
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
            {/* Held at the seat count when Kyro has counted more different
                people than the room holds. "change this to 114, because i
                dont know how you got this number ... i said the max is 114 in
                this room, so it must be inaccurate for you to put this
                number." The measurement is right there underneath it, and
                nothing behind the figure is changed — see people_seen_shown
                in worker/venue.js. */}
            {/**
              * The attendance figure, and NEVER a count of crossings.
              *
              * ── What was wrong ──────────────────────────────────────────
              *
              * "this is not the right number, it needs to be the same as
              * this [25]" … "the more accurate one."
              *
              * This tile said 84 under the words "Came in, this session",
              * with 25 people in the room. Neither figure was attendance.
              *
              * 84 was the cameras' own tally of CROSSINGS — every time a
              * camera became sure of somebody, which for a room camera is
              * over and over all service. The small print gave it away:
              * "24 more came in than went out" is a sum about crossings,
              * not about people. It was a fallback for when the register
              * had nothing to say, and a fallback that answers a different
              * question under the same heading is worse than no fallback.
              *
              * 25 is the most the cameras saw at ONE MOMENT. That is a
              * floor — no camera sees a whole hall — and it is honest, so
              * it is what is shown when there is nothing better, said in
              * those words.
              *
              * The order is: the figure held at the seats, then the
              * attendance every other page shows, then the register's own
              * movement, and only then the floor. Crossings never appear
              * here at all.
              */}
            {/**
              * …and SINCE WHEN.
              *
              * "how did the number go all the way down to 84-60, it was
              * literally 1 hundred and something before."
              *
              * Because it is this SESSION, and the session had started
              * again. Stopping the last camera ends a session — which is
              * what the church asked for, in those words — so the next run
              * counts from zero. Nothing was lost and nothing went
              * backwards: the heading was answering a different question
              * from the one it had answered five minutes earlier, and said
              * nothing about the change.
              *
              * A figure labelled "this session" that will not say when the
              * session began is a figure nobody can check. The whole day is
              * still one click away, as it always was.
              */}
            {/* One word for one figure, everywhere. The service card called
                this "Came in" and the Sessions card called the same idea
                "Entries": "this is meant to be the session structure [...]
                so i dont know why its like this". */}
            <StatTile label={`${showingSession && sessionFrom ? `Entries, since ${fmtTime(sessionFrom)}` : showingSession ? "Entries, this session" : "Entries, all day"}${unverified ? " (unverified)" : ""}`} swatch={ARRIVE}
              value={(held ?? attendanceShown ?? summary.totalArrived).toLocaleString()}
              sub={held != null
                ? `Held at the ${held.toLocaleString()} seats in this room · Kyro counted ${(attendance ?? summary.totalArrived).toLocaleString()}`
                : attendance != null && attendance > 0
                ? "Different people, counted once each"
                : usingRegister
                ? "Different people, counted once each"
                : seenAtOnce != null && seenAtOnce > 0
                ? "The most seen at once — at least this many were here. Nobody is counting at a doorway, so Kyro cannot say how many different people came."
                : "Nobody counted yet"}
              action={onSetSeats && !seats && usingRegister
                ? { label: "Kyro doesn't know how many seats this room has. Set it \u2192",
                    // Opened empty, not filled in with somebody else's hall.
                    onClick: () => { setSeatDraft(""); seatBox.current?.scrollIntoView({ behavior: "smooth", block: "center" }); } }
                : held != null && onSetSeats
                ? { label: "Change the number of seats \u2192",
                    onClick: () => { setSeatDraft(String(held)); seatBox.current?.scrollIntoView({ behavior: "smooth", block: "center" }); } }
                : undefined}
              /**
               * …and when this login may not set it, SAY THAT.
               *
               * The line above renders only for somebody allowed to change
               * the seat count. For anybody else there was nothing at all —
               * not the control, not the reason, no sign that a seat count
               * is what this figure is missing. The failure and the silence
               * looked identical from the outside, which is how "its still
               * not 114" was asked six times about a setting that was never
               * on the screen.
               */
              note={!onSetSeats && !seats && usingRegister
                ? "Kyro has not been told how many seats this room has, so this figure has nothing to answer to. An administrator can set it on the Cameras page."
                : undefined} />
            <StatTile label={`${showingSession && sessionFrom ? `Went out, since ${fmtTime(sessionFrom)}` : showingSession ? "Went out, this session" : "Went out, all day"}${unverified ? " (unverified)" : ""}`} swatch={LEAVE}
              value={(heldLeft ?? summary.totalLeft).toLocaleString()}
              sub={heldLeft != null
                ? `Held with the figure beside it \u00b7 ${Math.max(0, summary.totalArrived - summary.totalLeft).toLocaleString()} still here`
                : usingRegister
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
