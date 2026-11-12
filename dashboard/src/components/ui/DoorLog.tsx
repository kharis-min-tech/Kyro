"use client";

/**
 * "I don't know what you're counting."
 *
 * Every decision the doorway cameras made, as they made it, in words that can
 * be held up against the door itself: counted in, counted out, recognised and
 * not counted again, or at the door and went back the way they came.
 *
 * Nothing here says who anyone is. A time, a camera, and one word.
 */

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, DoorOpen, RotateCcw, HelpCircle } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";

const BORDER = "var(--border-subtle)";

interface DoorEvent { camera: string; camera_id: string; at: string; kind: string }
interface DoorLog {
  events: DoorEvent[];
  counted_in: number; counted_out: number;
  repeats_not_counted: number; unclear: number;
}

const WORDS: Record<string, { text: string; colour: string; Icon: typeof ArrowUpRight }> = {
  "in":        { text: "Counted IN",  colour: "var(--series-arrive)", Icon: ArrowUpRight },
  "out":       { text: "Counted OUT", colour: "var(--series-leave)",  Icon: ArrowDownLeft },
  "again-in":  { text: "Same person coming in again — not counted",  colour: "var(--text-tertiary)", Icon: RotateCcw },
  "again-out": { text: "Same person going out again — not counted",  colour: "var(--text-tertiary)", Icon: RotateCcw },
  "unclear":   { text: "At the door, went back the way they came — not counted", colour: "var(--text-faint)", Icon: HelpCircle },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

interface Identity {
  unique_people: number; active_tracks: number; seen_on_more_than_one_camera: number;
  uncertain_matches: number; with_a_face: number; matched_by_track: number;
  matched_by_face: number; matched_by_look: number; flagged_matches: number;
  rejected_as_impossible: number; ruled_out_by_face: number; created: number;
  in_a_uniform: number; helped_by_their_seat: number; changed_seats: number; seated_now: number;
  joined_across_cameras?: number; not_people?: number; ignored_not_people?: number;
  found_again_in_their_seat?: number; two_boxes_one_person?: number;
  questions_open?: number; questions_waiting_for_a_picture?: number;
  questions_showing?: number; questions_answered?: number;
  cameras?: string[];
}

/**
 * How the register of people is doing.
 *
 * For whoever is asked whether the number can be trusted — never for ushers,
 * who need one number. No faces, no pictures, nothing about who anybody is:
 * counts, and how each match was made.
 */
export function IdentityHealth() {
  const [d, setD] = useState<Identity | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => edgeFetch<Identity>("/api/live/identity")
      .then((r) => { if (alive) setD(r); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!d || !d.unique_people) return null;
  // "Is the cameras even working together or seperately?" — answered first,
  // in the cameras' own terms, because it is the question that decides
  // whether the figure above it means anything. They do share one register:
  // one entry per human being, whichever camera sees them. What that line
  // shows is whether the sharing is actually catching anybody.
  const cams = d.cameras?.length ?? 0;
  const rows: [string, number, string][] = [
    ["Different people", d.unique_people, "the attendance figure — the size of the register"],
    ...(cams > 1 ? [[
      "Cameras feeding one register", cams,
      `${d.seen_on_more_than_one_camera} ${d.seen_on_more_than_one_camera === 1 ? "person has" : "people have"} been recognised on more than one of them, and counted once`,
    ] as [string, number, string]] : []),
    ...(d.joined_across_cameras ? [[
      "Joined up by the other camera", d.joined_across_cameras,
      "another camera was looking at the same person, so they got the same entry rather than a new one",
    ] as [string, number, string]] : []),
    ...(d.not_people ? [[
      "Ruled not a person", d.not_people,
      "a pillow, a coat over a chair, a poster — taken off the count and off the day's figures",
    ] as [string, number, string]] : []),
    ...(d.ignored_not_people ? [[
      "Not counted again since", d.ignored_not_people,
      "sightings that looked like one of those, left out rather than asked about again",
    ] as [string, number, string]] : []),
    ["Being followed right now", d.active_tracks, "people a camera currently has in view"],
    ["Seen by more than one camera", d.seen_on_more_than_one_camera, "counted once, not twice"],
    ["Recognised by their face", d.matched_by_face, "sightings matched to somebody already known"],
    ["Recognised by appearance", d.matched_by_look, "coat, build and height, when no face was readable"],
    ["Ruled out by their face", d.ruled_out_by_face, "looked alike, but plainly not the same person"],
    ["Ruled out as impossible", d.rejected_as_impossible, "could not have crossed the building that fast"],
    ["Matches Kyro isn't sure of", d.uncertain_matches, "attached to somebody, and flagged rather than hidden"],
    ["In a seat right now", d.seated_now ?? 0, "one person to a seat, one seat to a person"],
    ["Changed seats", d.changed_seats ?? 0, "a new seat, never a new person"],
    ["Everyone dressed alike", d.in_a_uniform ?? 0, "choir or ushers: appearance refused, only a face will do"],
    ["Helped by their seat", d.helped_by_their_seat ?? 0, "where they were sitting tipped a close match"],
    /**
     * What happened to the questions.
     *
     * "not one question has been shown … thats most likely why it is 179."
     *
     * Raised and shown are different things, and the difference is the whole
     * diagnosis. None raised means Kyro was never unsure — which, with a
     * figure of 179 in a room of 114, would itself be the fault. Raised but
     * waiting means it WAS unsure, asked, and the picture never arrived, so
     * nobody could answer. Opposite faults, opposite fixes.
     */
    ["Questions waiting to be answered", d.questions_showing ?? 0, "on screen now, with both pictures"],
    ["Questions Kyro couldn't show you", d.questions_waiting_for_a_picture ?? 0,
     "it was unsure and asked, but a picture of one of the two never arrived — so nobody could answer"],
    ["Questions you have answered", d.questions_answered ?? 0, "each one corrected the figures"],
    ["Two boxes, one person?", d.two_boxes_one_person ?? 0,
     "one camera drew two boxes that look like the same person at once — asked, never decided"],
    ["Lost and found in their seat", d.found_again_in_their_seat ?? 0,
     "the camera dropped them for a moment; they were the person sitting there, not a new arrival"],
  ];
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: `1px solid ${BORDER}` }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>How the counting is doing</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {d.unique_people.toLocaleString()} different people · {d.uncertain_matches} match{d.uncertain_matches === 1 ? "" : "es"} flagged as uncertain
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <table className="w-full" style={{ fontSize: 13, borderTop: `1px solid ${BORDER}` }}>
          <tbody>
            {rows.map(([label, value, why]) => (
              <tr key={label} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td className="px-5 py-2" style={{ color: "var(--text-secondary)" }}>
                  {label}<span style={{ color: "var(--text-faint)", fontSize: 11 }}> · {why}</span>
                </td>
                <td className="px-5 py-2 text-right tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                  {value.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function DoorLog() {
  const [log, setLog] = useState<DoorLog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => edgeFetch<DoorLog>("/api/live/door-log")
      .then((r) => { if (alive) { setLog(r); setErr(null); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Couldn't load it"); });
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (err) return null;
  if (!log) return null;
  const nothing = log.events.length === 0;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: `1px solid ${BORDER}` }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <DoorOpen size={14} /> What the entrance counted
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {nothing
              ? "Nothing yet. Each decision appears here as it is made."
              : <>Every decision, as it was made — <strong style={{ color: "var(--text-secondary)" }}>{log.counted_in} in</strong>,{" "}
                 <strong style={{ color: "var(--text-secondary)" }}>{log.counted_out} out</strong>, and{" "}
                 <strong style={{ color: "var(--text-secondary)" }}>{log.repeats_not_counted}</strong> the same person again, not counted.</>}
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{open ? "Hide" : "Show"}</span>
      </button>

      {open && !nothing && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          {/* The tally first: this is the answer to "are you duplicating people". */}
          <div className="px-5 py-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", background: "var(--bg-inset)" }}>
            {[
              { label: "Counted in", value: log.counted_in },
              { label: "Counted out", value: log.counted_out },
              { label: "Repeats turned away", value: log.repeats_not_counted },
              { label: "Too unclear to call", value: log.unclear },
            ].map((x) => (
              <div key={x.label}>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{x.label}</p>
                <p className="font-semibold tabular-nums" style={{ fontSize: 16, color: "var(--text-primary)" }}>{x.value.toLocaleString()}</p>
              </div>
            ))}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {log.events.map((e, i) => {
              const w = WORDS[e.kind] ?? { text: e.kind, colour: "var(--text-tertiary)", Icon: HelpCircle };
              return (
                <li key={`${e.at}-${i}`} className="px-5 py-2 flex items-center gap-3"
                  style={{ borderTop: i ? `1px solid ${BORDER}` : undefined, fontSize: 13 }}>
                  <w.Icon size={13} style={{ color: w.colour, flexShrink: 0 }} />
                  <span className="tabular-nums" style={{ color: "var(--text-tertiary)", fontSize: 12, width: 78, flexShrink: 0 }}>{time(e.at)}</span>
                  <span style={{ color: "var(--text-secondary)" }} className="min-w-0 flex-1">{w.text}</span>
                  <span style={{ color: "var(--text-faint)", fontSize: 11 }} className="truncate">{e.camera}</span>
                </li>
              );
            })}
          </ul>
          <p className="px-5 py-3" style={{ fontSize: 11, color: "var(--text-faint)", borderTop: `1px solid ${BORDER}` }}>
            A decision is made about fifteen seconds after someone leaves the camera&apos;s view, which is how long Kyro waits
            in case they are only behind whoever came through next. &quot;Same person again&quot; means Kyro recognised them —
            by their coat and build, or their face when face matching is on — and had already counted them that way in this
            service. Everyone is forgotten when the service ends.
          </p>
        </div>
      )}
    </div>
  );
}
