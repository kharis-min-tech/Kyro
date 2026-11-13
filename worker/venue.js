/**
 * VenueHub (Durable Object) — the live link between the camera computer at
 * church ("Kyro Camera Box", camera-box/) and the website.
 *
 * Holds: paired camera computers, one-time pairing codes, the cameras each
 * box reports (with the room / seat count an admin sets on the website),
 * the latest live counts, a per-minute history for charts, and the latest
 * picture per camera. A camera plugged into the box appears here on the
 * box's next report — nothing to set up on the website.
 */
import { DurableObject } from "cloudflare:workers";
import { notifyCount } from "./index.js";
import { IdentityRegistry, LOOK_SAME } from "./identity.js";
import { Building } from "./building.js";
import { Trouble, cameraHealth } from "./health.js";

const enc = new TextEncoder();
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const b64url = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const sha256 = async (text) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const num = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};

const OFFLINE_AFTER_MS = 45_000;  // no report for this long → camera shown offline
const SAMPLE_EVERY_MS = 60_000;   // one history row per camera per minute
const MAX_SNAPSHOT_BYTES = 120_000;   // a stored value is capped at 128 KB
const ALERT_GAP_MS = 10 * 60_000;
/** …and between "Kyro has a question" alerts, for the same reason. */
const ASK_ALERT_GAP_MS = 10 * 60_000; // per room, between "filling up" phone alerts
const JOB_TTL_MS = 2 * 60_000;    // "Find cameras" / "Add this camera" requests (and any login in them) expire

const MAX_SEATS = 900;            // per camera: a stored value is capped at 128 KB
const SAFE_VALUE_BYTES = 110_000; // comfortably inside that 128 KB
/**
 * Shorter than this in view, on average, and a camera is on a doorway.
 *
 * Generous on purpose. A congregation sits for an hour; people pass a door
 * in seconds. Anything in between — a foyer where people stand and talk, a
 * creche — is left alone rather than second-guessed, because being wrong
 * about this the other way would tell somebody to stop counting their room.
 */
const DOORWAY_LIFE_S = 25;
/**
 * The most people a doorway's own record is kept for.
 *
 * The same ceiling the browser keeps, so everything handed back fits where
 * it is going. Eight hundred is more than any one door sees in a morning.
 */
const MOST_DOOR_REMEMBERED = 800;
const SERVICE_START_PEOPLE = 5;   // this many people in the venue …
const SERVICE_START_MS = 2 * 60_000;   // … for this long = a service has started
const SERVICE_END_PEOPLE = 3;     // fewer than this …
const SERVICE_END_MS = 15 * 60_000;    // … for this long = the service has ended
/**
 * How long after a rota entry finishes Kyro stops recording the service.
 *
 * Services overrun. A rota that says 10:00–11:30 is a plan, not a stopwatch,
 * and ending the recording on the dot would cut off the half of a morning
 * that people actually spend standing about talking. Long enough to cover an
 * overrun, short enough that an empty hall isn't still "in a service" an hour
 * later — and the room emptying still ends it sooner, as it always did.
 */
const ROTA_OVERRUN_MS = 20 * 60_000;
/**
 * How far ahead "what's on next" looks.
 *
 * Far enough to be useful on a Sunday morning, not so far that a page says
 * "next: Carol service" in the middle of November.
 */
const ROTA_AHEAD_MS = 12 * 3600_000;
const PEAK_HOLD_MS = 10_000;      // a service's "busiest" number must hold this long
/** "Sunday morning service", from the church's local time. */
function serviceName(ms) {
  const tz = "Europe/London";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(new Date(ms));
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(ms));
  return `${day} ${part} service · ${date}`;
}
const QUESTION_TTL_MS = 10 * 60_000;  // unanswered AI questions stay listed this long
/**
 * …except "is this the same chair?", which is not perishable.
 *
 * A question about a person is about one morning: ten minutes later the
 * figure has moved on and the answer is of no use. A chair is a chair every
 * Sunday, so its answer is worth having whenever it comes — and it may have
 * spent most of the ten minutes waiting for somebody to be at both seats,
 * which would leave almost no time to answer it.
 */
const CHAIR_QUESTION_TTL_MS = 60 * 60_000;
// Face codes older than this aren't compared. The box refreshes every 4 s and
// reports every 2 s, so this must comfortably exceed both or de-duplication
// flickers on and off and the total jumps about. Over-subtraction from a code
// that outlives the person is prevented by the clamp in venueTotal(), not here.
const FACE_FRESH_MS = 10_000;
/** How many door decisions are kept per camera for the "what was counted" panel. */
const DOOR_LOG_KEEP = 200;
/** How often the register of people is written down, so a restart keeps it. */
const REGISTER_SAVE_MS = 30_000;
/**
 * How long somebody has to be out of sight before Kyro says they have left.
 *
 * Not a guess at a doorway: this is the register's own last sighting of a
 * person. Shorter than this and a camera losing somebody behind a pillar for
 * a minute becomes a departure, which is the whole fault being fixed here.
 */
const LEFT_AFTER_MS = 5 * 60_000;
/**
 * How long the record of when each person was first and last seen is kept.
 *
 * It is two timestamps and a number per person — no face code, no appearance
 * reading, nothing that describes anybody — and it is what every attendance
 * figure older than today is built from, so a year of Sundays stays
 * answerable.
 */
const PEOPLE_KEPT_MS = 400 * 86400_000;
/** How long the arrivals-and-departures figures are held before being worked
 *  out again. Shorter than how often they can change (REGISTER_SAVE_MS). */
const MOVEMENT_FRESH_MS = 15_000;
/**
 * Face codes are deleted this long after they were written, whatever else
 * happens.
 *
 * The promise is that face data lives for one service. Ending a service
 * deletes it — but a service that never ends properly (a camera computer
 * switched off mid-morning, a timer that failed) would otherwise keep
 * biometric data alive indefinitely, which is the one thing that must not be
 * possible. So there is a limit that depends on nothing working correctly.
 */
const FACE_MAX_AGE_MS = 12 * 60 * 60_000;
const DEFAULT_COUNT_CONFIDENCE = 0.3;   // matches the camera computer's own default
/** The two ends of the setting — see SENSITIVE_CONFIDENCE in peopleDetector.ts. */
const SENSITIVE_CONFIDENCE = 0.2;
const CAREFUL_CONFIDENCE = 0.4;
/**
 * What makes a gap worth mentioning, and what makes it worth blaming on the
 * setting rather than on where the camera is pointed.
 *
 * A handful either way is ordinary: people are in doorways, behind pillars,
 * halfway out of shot. Kyro only speaks up when the gap is bigger than
 * that, AND when being less fussy would close a real share of it.
 */
const SUGGEST_SHORT_BY = 5;
const SUGGEST_GAIN_AT_LEAST = 3;
const SUGGEST_GAIN_SHARE = 0.4;
/**
 * …and what Kyro has to be sure of before it moves the setting ITSELF.
 *
 * "to be honest, i have a lot on my hands, its better for you to do it
 * yourself, just let me know that you have changed it."
 *
 * Two rules, both about not flapping. The same answer has to hold for three
 * minutes — somebody walking a row, or the door busy for a moment while the
 * hall has not caught up, changes the figures for seconds at a time. And
 * nothing moves twice inside twenty minutes, so a building that sits on the
 * line cannot be switched back and forth all morning.
 */
const AUTO_SET_AFTER_MS = 3 * 60_000;
const AUTO_SET_GAP_MS = 20 * 60_000;
/** How long the change stays on the card where she will see it. */
const AUTO_SET_SHOW_MS = 6 * 60 * 60_000;
const DELETED_KEPT_DAYS = 30;     // how long a deleted day can still be brought back
/**
 * A picture older than this is not of now, and is not shown.
 *
 * The camera computer sends one every twenty seconds while it is counting, so
 * anything older than a couple of minutes means it has stopped — and a
 * photograph of a full hall is a very convincing thing to put under the word
 * "Offline".
 */
const SNAPSHOT_STALE_MS = 3 * 60_000;
/**
 * In/out recorded before this moment can't be trusted and is never charted.
 *
 * Two reasons, in order.
 *
 * Until the tracking fix went live (commit 89292f9, 4 Nov 2026 18:33 UTC) a
 * person merely flickering out of the AI's view was read as leaving and
 * arriving again — one person sitting still produced ten arrivals.
 *
 * And until 8 Nov 2026 a camera watching a doorway still counted the way a
 * camera watching a room does: appearing meant arriving, disappearing meant
 * leaving. Everybody passing a door does both, whichever way they are walking,
 * so arrivals climbed all morning while a room emptied and departures appeared
 * out of nowhere — "53 people left" from a room holding twenty. Counting by
 * the direction someone walked only began at the moment below, and nothing
 * before it is a measurement of anyone going in or out.
 *
 * The rows are kept, because the people counts in them are fine; only their
 * arrivals and departures are withheld.
 */
const IN_OUT_TRUSTED_FROM = Date.parse("2026-11-08T12:22:00Z");
/**
 * Bumped whenever this file gains something the website will ask for. Read
 * back through /api/version, so a deploy can be checked rather than believed —
 * see the note on /internal/version.
 */
export const VENUE_CODE = "venue-a5b4044b802b";
/**
 * A fixed seat count for this church used to live here.
 *
 * "remove the idea of there being 114 seats now, like remove it completely."
 *
 * It was put in because the number had nowhere else to live: the field that
 * should have held it was on a settings page nobody could find, then on a
 * card a browser was too old to show, then behind a permission. None of that
 * is true any more — it can be set from beside the figure it corrects — so a
 * building's seat count has no business being written into the program that
 * counts for every building.
 *
 * Seats are now only ever a number somebody entered. No number, no seat
 * count: "Seats —", no hold, no "spaces left", and nothing pretending to
 * know how full a room is. That is the honest answer to a question nobody
 * has answered, and it is what the rest of this file already does
 * everywhere else.
 */
// A browser says "still here" every 10 seconds and says goodbye when it is
// closed or put away, so this only has to cover an ungraceful exit — a crash,
// a flat battery, Wi-Fi dropping. Three missed hellos and it is treated as gone.
const PRESENCE_STALE_MS = 30_000;
const MAX_SESSIONS_PER_USER = 20; // same account signed in from more places than this: keep the newest
const MIN_FPS_FOR_IN_OUT = 2;     // counts a second needed before in/out is trustworthy
const MIN_FPS_FOR_DOOR = 3;       // a doorway needs more: people cross it in a second or two
const MOVED_AFTER_MS = 10 * 60_000;  // a camera must be gone this long before another computer claims it
const MAX_WEB_DEVICES = 50;       // Camera Mode browsers kept at once
const FACE_SAME = 0.5;                // SFace cosine similarity for "same person" (strict: no false merges)
const QUESTION_TYPES = ["stage_question", "front_rush_question", "absence_question", "zone_proposal", "altar_call_question", "seat_question", "same_person_question", "is_this_a_person"];
/**
 * How long Kyro waits for a picture of each side of "is this the same
 * person?" before giving up on the question.
 *
 * The pictures come from the browser doing the counting, which is asked for
 * them in its next reply — a few seconds away. Without both, the question is
 * two names and a number, which nobody can answer, so it is not shown.
 */
const ASK_PICTURE_WAIT_MS = 60_000;
/**
 * …and longer for "is this the same chair?", which waits on a PERSON.
 *
 * A person question wants a crop of somebody who is in shot right now, so a
 * minute is plenty. A chair question wants whoever is at each of two
 * particular seats — standing by it counts, see whoIsAt — and those two
 * places may be empty for a good while. Giving up after a minute meant the
 * duplicate was never put to anybody.
 */
const CHAIR_PICTURE_WAIT_MS = 10 * 60_000;
/** How many "same person?" questions are kept waiting at once. More than this
 *  on screen is not a job anybody will finish. */
const MOST_ASKS = 12;
/**
 * How many answers before Kyro will move the line it matches people on.
 *
 * Few enough that a church sees it happen within a service or two of
 * answering; many enough that one odd answer, or one unusual pair of coats,
 * cannot move it. Below this the answers are still collected and still shown
 * — they simply do not change anything yet.
 */
const ANSWERS_BEFORE_LEARNING = 25;
/**
 * Arrivals and departures for one recorded reading.
 *
 * Kyro used to work these out from how the number in the room changed between
 * one minute and the next. That was wrong, and badly so: the AI count wobbles
 * (one person alone can read as 1, then 2, then 3 as the light or her chair
 * fools it), and every wobble became a person arriving and another leaving.
 * One person sitting still for forty minutes produced twenty-odd "in and outs".
 *
 * Each camera already counts arrivals and departures properly, following each
 * person from one count to the next, refusing to believe a flickering box, and
 * allowing someone 45 seconds out of sight before saying they left. It reports
 * those as running totals. This reads those totals instead.
 *
 *   - Only an increase counts. A total that goes down means counting restarted
 *     (a reload, a camera unplugged), which is not people leaving.
 *   - A camera's first reading only sets the starting point. People already in
 *     the room when counting began did not "arrive" while Kyro was watching,
 *     and counting them as arrivals is how a reload used to invent a crowd.
 *
 * Returns true once there is something real to compare against, which is what
 * tells the website it may show these figures at all.
 */
/**
 * A camera's arrivals / departures since the last fresh start.
 *
 * The cameras report running totals: 40 means 40 since the camera started, not
 * 40 just now. A fresh start remembers each camera's total at that moment, and
 * everything after it is measured from there — so a new session begins at zero
 * without a single reading being deleted.
 *
 * A counter that reads LOWER than the remembered total means the counting
 * started over (the browser counter was reset, or the camera computer
 * restarted), so the reading is already the count since then and stands as it
 * is. Same rule the arrival chart uses for the same reason.
 */
function sinceFresh(total, base) {
  const n = total || 0, b = base || 0;
  return n < b ? n : n - b;
}

/**
 * One room's figures from however many cameras are watching it.
 *
 * Kyro added its cameras together. Point two at the same room — which is the
 * obvious thing to do, to cover it properly — and every person in it was
 * counted twice. The only thing that ever took a duplicate back out was face
 * matching, which is biometric, off by default, and only runs during a live
 * service; without it the headline was simply double.
 *
 * Cameras that share a zone name are views of ONE room, so the room holds the
 * fullest view, never the sum. Two cameras seeing 13 and 11 of the same room
 * means about 13 people, not 24. It is still an estimate — a camera that can
 * only see half the room reports half — but it cannot be wildly over, and
 * being over is what makes a count worthless.
 *
 * Cameras in different zones are different rooms and are still added up.
 */
function roomTotals(zones) {
  const rooms = new Map();
  for (const z of zones) {
    const key = String(z.zone_name || z.camera_id || "").trim().toLowerCase();
    const r = rooms.get(key);
    const take = (a, b) => Math.max(a || 0, b || 0);
    if (!r) {
      rooms.set(key, {
        zone_name: z.zone_name, cameras: 1,
        current: z.current || 0, peak: z.peak || 0,
        entries: z.entries || 0, exits: z.exits || 0, capacity: z.capacity || 0,
        capacity_from: z.capacity_from ?? null,
        people: z.people || 0,
        // The same two figures before a fresh start was taken off them. How
        // many people are in the building is everyone who has come in today
        // less everyone who has gone out, which is not a thing a session's
        // figures can answer: start fresh at eleven o'clock with three hundred
        // people already sitting there and "in minus out" is nearly zero.
        entries_all: z.entries_all || 0, exits_all: z.exits_all || 0,
      });
    } else {
      r.cameras++;
      r.current = take(r.current, z.current);
      r.peak = take(r.peak, z.peak);
      // Arrivals and departures double in exactly the same way.
      r.entries = take(r.entries, z.entries);
      r.exits = take(r.exits, z.exits);
      r.entries_all = take(r.entries_all, z.entries_all);
      r.exits_all = take(r.exits_all, z.exits_all);
      // Two cameras on one room see the same congregation: the fullest view,
      // never the sum, exactly as with everything else about a room.
      r.people = take(r.people, z.people);
      // One room's seats are its seats, however many cameras watch them.
      r.capacity = take(r.capacity, z.capacity);
      // One camera in a room with a capacity somebody entered makes the room
      // measured; otherwise the room is as much of a guess as its cameras.
      if (z.capacity_from === "admin") r.capacity_from = "admin";
      else r.capacity_from ??= z.capacity_from ?? null;
    }
  }
  return [...rooms.values()];
}

function countedMovement(counters, row, arrivals, departures, hour) {
  const e = Math.max(0, Number(row.entries) || 0);
  const x = Math.max(0, Number(row.exits) || 0);
  const before = counters.get(row.camera_id);
  counters.set(row.camera_id, { e, x });
  if (!before) return false;              // first reading: the starting point only
  if (e >= before.e) arrivals[hour] += e - before.e;
  if (x >= before.x) departures[hour] += x - before.x;
  return true;
}

function cleanQuestion(q, camera_id) {
  if (!q || !q.review_id) return null;
  return {
    type: "review_request", review_id: clean(q.review_id, 60), camera_id,
    review_type: QUESTION_TYPES.includes(q.review_type) ? q.review_type : "absence_question",
    target_role: q.target_role === "admin" ? "admin" : "operator", question: clean(q.question, 300),
    track_id: num(q.track_id, -1, 1e9), seat_id: q.seat_id ? clean(q.seat_id, 40) : null,
    position: Array.isArray(q.position) ? q.position.slice(0, 2).map((v) => Number(v) || 0) : [0, 0],
    bbox_hint: Array.isArray(q.bbox_hint) ? q.bbox_hint.slice(0, 4).map((v) => Number(v) || 0) : null,
    confidence: Math.min(1, Math.max(0, Number(q.confidence) || 0)), best_guess: clean(q.best_guess, 60),
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map((o) => clean(o, 60)).filter(Boolean),
    created_at: Number(q.created_at) || Date.now() / 1000,
  };
}
/** A face code from the camera computer (128 float16 numbers, base64) → Float32Array. */
function unpackFace(b64) {
  try {
    const bin = atob(String(b64));
    if (bin.length !== 256) return null;
    const u16 = new Uint16Array(128);
    for (let i = 0; i < 128; i++) u16[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    const out = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
      out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? 0 : s * (1 + m / 1024) * 2 ** (e - 15);
    }
    let n = 0; for (const v of out) n += v * v; n = Math.sqrt(n) || 1;
    for (let i = 0; i < 128; i++) out[i] /= n;
    return out;
  } catch { return null; }
}
/**
 * …and back again, for writing one down.
 *
 * ── The bug this is ────────────────────────────────────────────────────────
 *
 * saveFaces has been calling packFace since the day it was written. Nothing
 * of that name has ever existed here. Every attempt to write a face threw a
 * ReferenceError, was swallowed by the try round the register, and reported
 * as general trouble with "Register of people" — so NO FACE HAS EVER BEEN
 * WRITTEN DOWN, and the table they were supposedly kept in has always been
 * empty.
 *
 * Which makes a second fault from today worse than it looked: the method for
 * putting faces back after a restart was never called, and even if it had
 * been there was nothing for it to read. Face matching could work inside one
 * running process and never survived anything.
 *
 * Exactly the inverse of unpackFace above: 128 numbers as float16, little
 * endian, base64. The same form the camera sends, so what comes back out
 * matches what went in.
 */
function packFace(v) {
  if (!v || v.length !== 128) return null;
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 128; i++) {
    const f = new Float32Array([v[i]]);
    const bits = new Uint32Array(f.buffer)[0];
    const sign = (bits >>> 16) & 0x8000;
    const exp = ((bits >>> 23) & 0xff) - 127 + 15;
    const mant = (bits >>> 13) & 0x3ff;
    const h = exp <= 0 ? sign : exp >= 31 ? sign | 0x7c00 : sign | (exp << 10) | mant;
    bytes[2 * i] = h & 0xff;
    bytes[2 * i + 1] = (h >> 8) & 0xff;
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
const SEAT_STATES = ["occupied", "temporarily_vacant", "likely_available", "available", "reserved", "rota_hold", "unknown"];
/** A seat drawn on the camera's picture (1280×720 coordinates). */
function cleanSeatDef(s) {
  if (!s || !Array.isArray(s.bbox) || s.bbox.length !== 4) return null;
  const b = s.bbox.map((v, i) => Math.min(i % 2 ? 720 : 1280, Math.max(0, Math.round(Number(v) * 10) / 10 || 0)));
  if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return null;
  return { seat_id: clean(s.seat_id, 24) || null, row: clean(s.row, 10), number: num(s.number, 0, 10000), section: clean(s.section, 24) || "Main",
    bbox: b, reserved: !!s.reserved, reserved_for: s.reserved ? clean(s.reserved_for, 60) || null : null };
}
/** [seat_id, state, seconds vacant, confidence] from the camera computer. */
function cleanSeatState(s) {
  if (!Array.isArray(s)) return null;
  const state = SEAT_STATES.includes(s[1]) ? s[1] : "unknown";
  return [clean(s[0], 40), state, num(s[2], 0, 86400), Math.round(Math.min(1, Math.max(0, Number(s[3]) || 0)) * 100) / 100];
}

/** Up to 10 rectangles [x1, y1, x2, y2] as 0–1 fractions of the picture. */
function cleanZones(z) {
  if (!Array.isArray(z)) return [];
  return z.slice(0, 10).map((r) => (Array.isArray(r) ? r.slice(0, 4).map((v) => Math.min(1, Math.max(0, Number(v) || 0))) : null))
    .filter((r) => r && r.length === 4 && r[2] - r[0] > 0.005 && r[3] - r[1] > 0.005)
    .map((r) => r.map((v) => Math.round(v * 10000) / 10000));
}

export class VenueHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lastSample = new Map();
    this.seenAt = new Map();   // camera_id → when its computer last said it's plugged in
    // Face matching (only while switched on): camera_id → { at, codes: Float32Array[] }.
    // Kept in memory only, for under a minute — never written to storage.
    this.faceCodes = new Map();
    /**
     * Who is in the building: one entry per person, for one service, shared by
     * every camera. This is where the attendance figure comes from — see
     * worker/identity.js. Built on the first report and restored from storage
     * after a restart, so the process being replaced mid-service does not
     * start the congregation again from nobody.
     */
    this.register = null;
    this.registerSavedAt = 0;
    /** The last time the people table was brought up to date, and for which
     *  service — so a save only rewrites the rows that have changed. */
    this.peopleSavedAt = 0;
    this.peopleSavedFor = null;
    /** Arrivals and departures worked out from those rows, held between
     *  saves. Every open page asks for this every few seconds. */
    this.movementCache = null;
    /**
     * The building: one master seat per physical chair, whatever number of
     * cameras can see it. See worker/building.js. Loaded on first use and
     * written whenever it changes.
     */
    this.building = null;
    this.buildingSavedAt = 0;
    /**
     * What is wrong with Kyro, where, and since when — see worker/health.js.
     * Loaded on first use; every failure below ends up here instead of in a
     * console log nobody at the church can read.
     */
    this.trouble = null;
    /** camera → the last few door decisions, for the "what was counted" panel. */
    this.doorLog = new Map();
    // Who is signed in right now: username → deviceId → { name, role, device, at }.
    // Memory only — if this restarts, everyone's next heartbeat rebuilds it
    // within half a minute, and nothing is worth storing.
    this.presence = new Map();
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS history (ts INTEGER NOT NULL, camera_id TEXT NOT NULL, current INTEGER, entries INTEGER, exits INTEGER, capacity INTEGER)",
      );
      /**
       * How many DIFFERENT people each camera had seen at that moment.
       *
       * Added later, so the table has to be altered rather than created with
       * it — and a table that already has the column must not throw, which
       * is why this is wrapped. Its own exec call: a second argument to exec
       * is a BIND PARAMETER, not another statement, and writing two
       * statements that way once stopped the whole live-cameras server from
       * starting at all.
       *
       * It is here because a DOORWAY's count of different people is the
       * attendance figure in a building where no camera sees the whole hall
       * — "the door camera basically needs to do the counting" — and until
       * now nothing wrote it down, so the live card and the history page
       * were about to answer the same question with two different numbers.
       */
      try { ctx.storage.sql.exec("ALTER TABLE history ADD COLUMN people INTEGER"); }
      catch { /* already there */ }
      /*
       * Face codes, for the length of ONE service.
       *
       * They were held in memory only, which sounded like the careful choice
       * and was not: the live-cameras server restarts on every deploy, each
       * restart lost every face, and the congregation had to be recognised by
       * their coats alone. Twenty five people became twenty nine — four
       * counted twice by a privacy measure that protected nobody, because the
       * data was being processed either way, just badly.
       *
       * They belong to the service. The row carries which service it is for,
       * so ending that service deletes them, and so does a hard age limit
       * that does not care whether a service ever ended properly — see
       * FACE_MAX_AGE_MS. A face code is 128 numbers describing a face: not a
       * photograph, not a name, and it cannot be turned back into either.
       *
       * Its own exec call. Writing it as a second argument to the one above
       * made it a BIND PARAMETER rather than a statement, which creates no
       * table and throws — inside blockConcurrencyWhile, so the whole
       * live-cameras server failed to start. The deploy said "uploaded", the
       * pages were fine, and every camera request died. That is what the
       * version check in the deploy script is for.
       */
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS faces (service TEXT NOT NULL, person INTEGER NOT NULL, code TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (service, person))",
      );
      /*
       * When each DIFFERENT person was first and last seen.
       *
       * This is the only honest source of "how many arrived" there is without
       * a camera on a doorway. A camera on a ROOM reports "entries", which
       * counts every person it becomes sure of — and over an afternoon it
       * becomes sure of the same congregation again and again. One person
       * sitting at a desk produced ELEVEN arrivals and eight departures, and
       * every page in Kyro repeated it: attendance 11, busiest day 11,
       * average attendance 11, "2 people left" at 4:15.
       *
       * The register (worker/identity.js) already knows those were one
       * person. It was only ever held in memory for the length of a service,
       * so nothing afterwards could ask it. One row per person per service
       * fixes that: attendance is how many rows, arrivals are their first
       * sightings, departures their last.
       *
       * No face code, no appearance reading, no name — two timestamps and a
       * number that means nothing outside its own service.
       *
       * Its own exec call. See the note above on the faces table for what
       * happens when that is forgotten.
       */
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS people (service TEXT NOT NULL, person INTEGER NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (service, person))",
      );
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS people_first ON people (first_at)");
      /**
       * Comings and goings — one row per visit, not per person.
       *
       * "make sure when people come in you log them in case they come out."
       *
       * The people table holds first seen and last seen, which is not the
       * same thing: somebody who comes in at ten, steps out at half past and
       * comes back at twenty to eleven has their last-seen time moved
       * forward and the fact that they LEFT disappears. Right for the
       * attendance figure, which must not count them twice; useless for the
       * question a church asks at the end of a service, which is whether the
       * building is clear.
       *
       * out_at is null while somebody is still here, which is what makes
       * "who is in the building" a thing that can be read back rather than
       * inferred from a clock. Each exec is its own call: a second argument
       * becomes a bind parameter and throws, which would take the whole
       * Durable Object down on startup.
       */
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS visits (service TEXT NOT NULL, person INTEGER NOT NULL, in_at INTEGER NOT NULL, out_at INTEGER, PRIMARY KEY (service, person, in_at))",
      );
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS visits_in ON visits (in_at)");
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS history_cam_ts ON history (camera_id, ts)");
      // Deleting a day marks its rows instead of removing them, so it can be
      // undone. They are only really gone after DELETED_KEPT_DAYS.
      try { ctx.storage.sql.exec("ALTER TABLE history ADD COLUMN deleted_at INTEGER"); } catch { /* already there */ }
      // Deleting a day has to take the people seen that day with it, or the
      // day comes straight back in Analytics with its attendance intact.
      try { ctx.storage.sql.exec("ALTER TABLE people ADD COLUMN deleted_at INTEGER"); } catch { /* already there */ }

      /**
       * Decide, once, where each camera's existing seat count came from.
       *
       * A capacity now carries its source, and one with no source recorded
       * is treated as a guess — which drives nothing. That is right for the
       * numbers the seat finder invented, and WRONG for a number somebody
       * had already typed in before the field existed: their seat count
       * silently stopped working and the page read "Seats —".
       *
       * There is one honest way to tell them apart. A capacity the seat
       * finder produced matches the "Found by Kyro" layout it produced it
       * from, seat for seat. Anything else was typed. Decided here, once, at
       * startup rather than on every read.
       */
      const cams = await ctx.storage.get("cameras");
      if (cams) {
        let changed = false;
        for (const c of Object.values(cams)) {
          if (!c || c.capacity_from || !c.zone_capacity) continue;
          const layouts = (await ctx.storage.get(`layouts:${c.camera_id}`)) ?? [];
          const found = layouts.find((l) => l.source === "auto" && l.is_active);
          c.capacity_from = found && found.seat_count === c.zone_capacity ? "found" : "admin";
          changed = true;
        }
        /**
         * …and taking any trace of it back off the cameras.
         *
         * A fixed seat count was once written onto every room camera, which
         * doubled the building when two cameras watched one hall under two
         * names. It is gone from the code; this takes it off the cameras of
         * anybody who ran that version, once, and never touches a number
         * somebody typed themselves — a capacity with a layout behind it, or
         * one that does not match what was written, is theirs.
         */
        if (!(await ctx.storage.get("seats_off_cameras_v2"))) {
          const was = await ctx.storage.get("seats_once_written");
          for (const c of Object.values(cams)) {
            if (!c || c.capacity_from !== "admin") continue;
            if (!was || c.zone_capacity !== was) continue;
            c.zone_capacity = 0;
            c.capacity_from = null;
            changed = true;
          }
          await ctx.storage.put("seats_off_cameras_v2", true);
        }
        if (changed) await ctx.storage.put("cameras", cams);
      }
    });
  }

  async get(key, fallback) { return (await this.ctx.storage.get(key)) ?? fallback; }

  /**
   * How many seats this building has.
   *
   * One answer, used by every figure that checks an attendance against the
   * room — the live card and the history pages alike. They disagreed for an
   * evening: the live figure was held at 114 while "Busiest day" and
   * "Average attendance" on the next page over both read 302, which is the
   * same number saying two different things on two screens.
   *
   * Entered capacities only, a room at a time: two cameras on one hall take
   * the fullest view of it, never the sum, and separate rooms add up. When
   * nothing has been entered, the answer is nothing — a room nobody has
   * given a capacity cannot be checked against one, and "Seats —" is the
   * honest answer to a question nobody has answered.
   */
  async seatsInBuilding() {
    const cams = await this.get("cameras", {});
    const byRoom = new Map();
    for (const c of Object.values(cams)) {
      if (!c || c.hidden || c.pending) continue;
      if (c.location === "entrance" || c.location === "queue") continue;
      if (c.capacity_from !== "admin" || !(c.zone_capacity > 0)) continue;
      const room = (c.zone_name || c.name || c.camera_id).trim().toLowerCase();
      byRoom.set(room, Math.max(byRoom.get(room) ?? 0, c.zone_capacity));
    }
    // No number, no seat count. A room nobody has given a capacity cannot be
    // checked against one, and saying so is the honest answer.
    return [...byRoom.values()].reduce((n, v) => n + v, 0);
  }

  // Seat layouts and live seat states are kept one key PER CAMERA. A single
  // storage value is capped at 128 KB, and one 1,000-seat room already fills it —
  // sharing one key across cameras made every report fail once a big room was found.
  // The seats themselves live one key PER LAYOUT, because a stored value is
  // capped at 128 KB and a big room's seats fill most of one on their own.
  async layoutsOf(camera_id) { return await this.get(`layouts:${camera_id}`, []); }
  async putLayouts(camera_id, list) {
    await this.ctx.storage.put(`layouts:${camera_id}`, list.map(({ seats, ...meta }) => meta));
    for (const l of list) {
      if (!l.seats) continue;
      // Last line of defence: whatever the seat names are, this must fit one stored value.
      let seats = l.seats;
      while (seats.length && JSON.stringify(seats).length > SAFE_VALUE_BYTES) seats = seats.slice(0, Math.floor(seats.length * 0.9));
      if (seats.length !== l.seats.length) console.log(`trimmed ${camera_id} layout ${l.id} to ${seats.length} seats to fit storage`);
      await this.ctx.storage.put(`lseats:${camera_id}:${l.id}`, seats);
    }
  }
  async seatsOf(camera_id, id) { return await this.get(`lseats:${camera_id}:${id}`, []); }
  /** A layout with its seats loaded. */
  async layoutWithSeats(camera_id, l) { return l ? { ...l, seats: await this.seatsOf(camera_id, l.id) } : null; }

  async fetch(request) {
    // When anything last spoke to this server — see /internal/version. It is
    // the number that answers "why has the new code not arrived".
    this.lastSpokenTo = Date.now();
    const url = new URL(request.url);
    const p = url.pathname;
    const role = request.headers.get("X-Kyro-Role") || "";   // set by index.js after checking the session
    try {
      // ── Inside the Worker only (index.js never forwards /internal/*) ──
      if (p === "/internal/day-peaks" && request.headers.get("X-Kyro-Internal") === "1") return json(await this.dayPeaks(url.searchParams.get("date") || "", url.searchParams.get("tz") || "UTC"));
      // Which version of THIS file is actually running. A Durable Object
      // carries on running the code it started with — a deploy doesn't reach
      // one that is still busy — so "deployed ✓" can be true while the live
      // link to the cameras is still answering with last week's code. That is
      // exactly what happened to "Start fresh": the button was new, the server
      // it called was not, and all anyone saw was "Not found".
      if (p === "/internal/version" && request.headers.get("X-Kyro-Internal") === "1") {
        /**
         * …and WHAT IS KEEPING IT AWAKE.
         *
         * This server only picks up newly deployed code when it is evicted,
         * and it is only evicted when nothing has spoken to it for a few
         * seconds. Five deploys in a row failed to reach it, and all anybody
         * could do was guess at what was holding it open — a browser tab, a
         * camera computer, a phone, somebody else's laptop. "my tab is not
         * open, i dont know what your seeing" is a fair thing to say to a
         * program that will not tell you.
         *
         * So it says. How many live connections it is holding and when it
         * was last spoken to are the two facts that answer it, and neither
         * is a secret: no names, no counts of people, nothing about anybody
         * in the building.
         */
        let sockets = 0;
        try { sockets = this.ctx.getWebSockets().length; } catch { sockets = -1; }
        return json({
          venue: VENUE_CODE,
          /** Open live connections — a counting browser, a camera computer,
           *  a page watching a camera. Each one wakes this server whenever
           *  it says anything. */
          sockets,
          /** Seconds since anything last spoke to it. It needs a few in a
           *  row with nobody talking before it can pick up new code. */
          idle_s: Math.round((Date.now() - (this.lastSpokenTo ?? 0)) / 1000),
        });
      }
      /**
       * Let go, so the new code can take over.
       *
       * ── Why a deploy could not reach this ───────────────────────────────
       *
       * This object is the live link to the cameras, and it carries on
       * running the code it started with until it next falls IDLE. During a
       * service it never does: a camera reports every few seconds, all
       * morning. So a deploy reached the pages in seconds and the counting
       * brain not at all, and the only way through was to ask somebody to
       * stop their cameras mid-service and wait a minute.
       *
       * That happened twice in one evening, and in between, every answer
       * Kyro gave was computed by code from before the fix: "still not 114",
       * six times, while the fix sat deployed and unreachable.
       *
       * So it can now be told to let go. Everything that only lives in
       * memory is written down first; the next request builds a fresh object
       * from storage, running the new code. A service loses nothing it had
       * saved, which is the register, the counters and the day's history.
       *
       * Only ever reachable from the worker in front of it (see the header),
       * and the worker only asks when the code it is running is genuinely
       * older than the code just deployed — never on anybody else's say-so.
       */
      if (p === "/internal/restart" && request.headers.get("X-Kyro-Internal") === "1") {
        try {
          if (this.register) await this.ctx.storage.put("register", this.register.snapshot(SAFE_VALUE_BYTES));
          const service = (await this.get("service_live", null))?.id ?? null;
          if (service) this.savePeople(service);
        } catch { /* going either way; a stale brain is worse than a lost second */ }
        // After the reply has gone, not before it: abort() stops this object
        // dead, and a caller left with a dropped connection cannot tell
        // "restarting" from "broken".
        setTimeout(() => { try { this.ctx.abort("a newer version of Kyro is deployed"); } catch { /* already gone */ } }, 100);
        return json({ restarting: true, was: VENUE_CODE });
      }

      // ── Camera computer (device token) ──
      if (p === "/api/devices/pair" && request.method === "POST") return this.pair(request);
      if (p === "/api/devices/report" && request.method === "POST") return this.withDevice(request, (d) => this.report(d, request));
      if (p === "/api/devices/snapshot" && request.method === "PUT") return this.withDevice(request, (d) => this.snapshot(d, request, url));
      if (p === "/api/devices/stream") return this.withDevice(request, (d) => this.boxStream(d, request));
      if (p === "/api/devices/auto-seats" && request.method === "POST") return this.withDevice(request, (d) => this.autoSeats(d, request));
      if (p === "/api/devices/question-snapshot" && request.method === "PUT") return this.withDevice(request, (d) => this.questionSnapshot(d, request, url));
      if (p === "/api/devices/seats" && request.method === "GET") return this.withDevice(request, (d) => this.boxSeats(d, url));
      if (p === "/api/devices/job" && request.method === "POST") return this.withDevice(request, (d) => this.jobResult(d, request));

      // ── Website (signed-in user) ──
      if (!role) return json({ error: "Please sign in again" }, 401);
      if (p === "/api/live/cameras" && request.method === "GET") return json(await this.cameraList(url.searchParams.get("all") === "1"));
      if (p === "/api/live/venue" && request.method === "GET") return json(await this.venueTotal());
      if (p === "/api/live/history" && request.method === "GET") return json(await this.history(url));
      if (p === "/api/live/daily" && request.method === "GET") return json(await this.daily(url));
      if (p.startsWith("/api/live/snapshot/") && request.method === "GET") return this.getSnapshot(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/watch/")) {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can watch the live cameras" }, 403);
        return this.watch(decodeURIComponent(p.split("/").pop()), request);
      }
      const user = decodeURIComponent(request.headers.get("X-Kyro-User") || "");
      const username = decodeURIComponent(request.headers.get("X-Kyro-Username") || "");
      // Anyone signed in says "still here"; only an administrator may see the list.
      if (p === "/api/live/presence" && request.method === "POST") return this.hereNow(request, username, user, role);
      if (p === "/api/live/presence/bye" && request.method === "POST") return this.goneNow(request, username);
      if (p === "/api/live/presence" && request.method === "GET") {
        if (role !== "admin") return json({ error: "Only administrators can see who is signed in" }, 403);
        return json(this.whoIsHere());
      }
      // A role is derived from the pages someone was given, so "Analytics only"
      // comes out as operator. Check the actual page too, or that person could
      // change the rota or black out part of the hall with an ignore area.
      const pages = (request.headers.get("X-Kyro-Pages") || "").split(",").filter(Boolean);
      const mayUse = (page) => role === "admin" || pages.includes(page);
      if (p === "/api/live/questions" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators see AI questions" }, 403);
        return json(await this.listQuestions(role));
      }
      const qm = p.match(/^\/api\/live\/questions\/([\w-]+)\/(answer|snapshot)$/);
      // A question's photo shows people in the building: only those it's asked of may see it.
      if (qm && role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators see AI questions" }, 403);
      if (qm && qm[2] === "snapshot" && request.method === "GET") {
        const side = ["a", "b"].includes(url.searchParams.get("side")) ? url.searchParams.get("side") : null;
        return this.getQuestionSnapshot(qm[1], role, side);
      }
      if (qm && qm[2] === "answer" && request.method === "POST") return this.answerQuestion(qm[1], role, user, request);
      if (p === "/api/live/rota" && request.method === "GET") return json(await this.get("rota", []));
      if (p.startsWith("/api/live/zones/") && request.method === "GET") return json((await this.get("seat_zones", {}))[decodeURIComponent(p.split("/").pop())] ?? []);
      if (p === "/api/live/privacy" && request.method === "GET") return json(await this.privacy());
      if (p === "/api/live/counting" && request.method === "GET") return json(await this.counting());
      if (p === "/api/live/services" && request.method === "GET") return json(await this.listServices());
      if (p === "/api/live/service/start" && request.method === "POST") {
        if (role !== "admin") return json({ error: "Only administrators can start a service" }, 403);
        return json(await this.startServiceNow());
      }
      // "Start fresh": the arrivals and departures begin again from zero for a
      // new session. Whoever may run the counting may do this; it deletes
      // nothing (see freshStart).
      // "Everybody is leaving now" — see PersonTracker.watchesDoorway.
      if (p === "/api/live/door-mode" && request.method === "POST") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can change this" }, 403);
        const b = await request.json().catch(() => ({}));
        const mode = ["auto", "in", "out"].includes(b.mode) ? b.mode : "auto";
        await this.ctx.storage.put("door_mode", { mode, by: user || "", at: Date.now() });
        return json({ mode });
      }
      if (p === "/api/live/counts/fresh" && request.method === "POST") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can start the counts fresh" }, 403);
        {
          const b = await request.json().catch(() => ({}));
          return json(await this.freshStart(Date.now(), !!b.forget_people));
        }
      }
      if (p === "/api/live/services-deleted" && request.method === "GET") {
        // Tidied as it is read, so a service that has been deleted for more
        // than 30 days stops appearing in a list that promises 30 days.
        const log = this.tidyDeletedServices(await this.get("deleted_services", []));
        return json(log);
      }
      const undel = p.match(/^\/api\/live\/services-deleted\/([\w-]+)\/restore$/);
      if (undel && request.method === "POST") {
        if (role !== "admin") return json({ error: "Only administrators can bring a service back" }, 403);
        return this.restoreService(undel[1], user);
      }
      // Gone now rather than in thirty days. The only thing in Kyro that
      // really destroys a record, so: administrators only, and one service at
      // a time unless the whole bin is asked for by name. See purgeService.
      if (p === "/api/live/services-deleted" && request.method === "DELETE") {
        if (role !== "admin") return json({ error: "Only administrators can delete a service for good" }, 403);
        return this.purgeAllServices(user);
      }
      const purge = p.match(/^\/api\/live\/services-deleted\/([\w-]+)$/);
      if (purge && request.method === "DELETE") {
        if (role !== "admin") return json({ error: "Only administrators can delete a service for good" }, 403);
        return this.purgeService(purge[1], user);
      }
      if (p === "/api/live/deleted-days" && request.method === "GET") return json(await this.deletedDays());
      if (p === "/api/live/movement" && request.method === "GET") return json(await this.movementByDay(url));
      // "What did you actually count?" — every decision the door cameras made
      // in the last little while, so it can be checked against the door.
      if (p === "/api/live/door-log" && request.method === "GET") return json(await this.doorLogFor());
      // Who came in, and whether they have gone out again.
      if (p === "/api/live/visits" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can see this" }, 403);
        return json(await this.visitLog());
      }
      // How the register of people is doing: counts and confidences, never a
      // face, a picture or anything about who anybody is.
      // ── The building: one master seat per physical chair ──────────────
      //
      // Reading it is for administrators and operators; changing it is for
      // administrators, which is how deleting a service and changing a
      // camera already work.
      if (p === "/api/live/building" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can see this" }, 403);
        return json((await this.theBuilding()).overview());
      }
      if (p === "/api/live/building" && request.method === "POST") {
        if (role !== "admin") return json({ error: "Only administrators can change the seating" }, 403);
        return json(await this.changeBuilding(request, user));
      }
      // Is Kyro actually working? Every check it can make, with what each one
      // is looking at — never a single green light standing in for all of it.
      if (p === "/api/live/health" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can see this" }, 403);
        return json(await this.healthReport());
      }
      // A problem about a camera that has been unplugged can never report
      // itself working again, so an administrator can put it aside. It is
      // marked fixed, not deleted, and comes straight back if it happens once
      // more — see Trouble.aside in worker/health.js.
      if (p === "/api/live/health/aside" && request.method === "POST") {
        if (role !== "admin") return json({ error: "Only administrators can put a problem aside" }, 403);
        const b = await request.json().catch(() => ({}));
        const n = b.all === true
          ? await this.putAsideAll(user)
          : await this.putAside(clean(b.where, 60), b.what ? clean(b.what, 200) : null, user);
        return json({ put_aside: n });
      }
      // The audit trail: every time Kyro declined to carry a counter
      // forward, and exactly what it did not count.
      if (p === "/api/live/count-audit" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can see this" }, 403);
        return json(await this.get("count_audit", []));
      }
      // What the "is this the same person?" answers add up to.
      if (p === "/api/live/learning" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can see this" }, 403);
        return json({ ...(await this.askLearning()), changes: await this.get("look_same_log", []) });
      }
      if (p === "/api/live/identity" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can see this" }, 403);
        /**
         * …and what has happened to the QUESTIONS.
         *
         * "not one question has been shown on questions being asked, not one
         * today … thats most likely why it is 179."
         *
         * She is right that it matters, and the gap she cannot see from
         * outside is between a question being RAISED and a question being
         * SHOWN. A same-person question is only shown once both pictures
         * have arrived from the counting browser, because being asked
         * whether two people you cannot see are the same person is not a
         * question anybody can answer. So a question whose second picture
         * never arrives waits for ever, in silence, and from the outside
         * that is indistinguishable from Kyro never having been unsure.
         *
         * Those are opposite faults with opposite fixes, and until now
         * nothing here could tell them apart.
         */
        const qs = Object.values(await this.get("questions", {}));
        const nowS = Date.now() / 1000;
        const live = qs.filter((q) => !q.answer && nowS - q.created_at < QUESTION_TTL_MS / 1000);
        return json({
          ...(this.register ? this.register.diagnostics() : { unique_people: 0, service: null }),
          /** Questions Kyro has raised and not had answered. */
          questions_open: live.length,
          /** …of those, the ones nobody can be shown yet, because a picture
           *  of one of the two people never arrived. */
          questions_waiting_for_a_picture: live.filter(
            (q) => (q.pictures ?? 0) < (q.review_type === "same_person_question" ? 2 : 1)).length,
          /** …and the ones that are on somebody's screen right now. */
          questions_showing: live.filter(
            (q) => (q.pictures ?? 0) >= (q.review_type === "same_person_question" ? 2 : 1)).length,
          /** Answered today. Zero with the others at zero means Kyro was
           *  never unsure; zero with questions waiting means it was unsure
           *  and could not ask. */
          questions_answered: qs.filter((q) => q.answer).length,
        });
      }
      const svc = p.match(/^\/api\/live\/services\/([\w-]+)(?:\/(keep|end|rename))?$/);
      if (svc && role !== "admin") return json({ error: "Only administrators can keep, rename or delete a service" }, 403);
      if (svc && svc[2] === "keep" && request.method === "POST") return this.keepService(svc[1], user);
      if (svc && svc[2] === "end" && request.method === "POST") return this.endServiceNow(svc[1]);
      if (svc && svc[2] === "rename" && request.method === "POST") return this.renameService(svc[1], request);
      if (svc && !svc[2] && request.method === "DELETE") return this.deleteService(svc[1], user, url.searchParams.get("counts") === "1");
      if (["/api/live/rota", "/api/live/zones/"].some((x) => p.startsWith(x))) {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can change this" }, 403);
        const page = p.startsWith("/api/live/rota") ? "rota" : "seating";
        if (!mayUse(page)) return json({ error: `You don't have the ${page === "rota" ? "Rota" : "Seat Map"} page` }, 403);
      }
      if (p === "/api/live/rota" && request.method === "POST") return this.addRota(request);
      if (p.startsWith("/api/live/rota/") && request.method === "DELETE") return this.removeRota(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/zones/") && request.method === "PUT") return this.saveZones(decodeURIComponent(p.split("/").pop()), request);
      if (p.startsWith("/api/live/seat-states/") && request.method === "GET") return json(await this.seatStates(decodeURIComponent(p.split("/").pop())));
      const lay = p.match(/^\/api\/live\/seats\/([^/]+)\/layouts(?:\/(\d+)(\/activate)?)?$/);
      if (lay && request.method === "GET" && !lay[2]) return json(await this.listLayouts(decodeURIComponent(lay[1])));

      if (p === "/api/live/browser-device" && request.method === "POST") {
        // Camera mode: a signed-in admin/operator's browser becomes a camera computer — no code needed.
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can use Camera mode" }, 403);
        return this.registerBrowser(request);
      }
      if (p.startsWith("/api/live/seat-reserve/") && request.method === "POST") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can reserve seats" }, 403);
        if (!mayUse("seating")) return json({ error: "You don't have the Seat Map page" }, 403);
        return this.reserveSeats(decodeURIComponent(p.split("/").pop()), request);
      }
      if (role !== "admin") return json({ error: "Only administrators can change camera settings" }, 403);
      if (p === "/api/live/pairing-code" && request.method === "POST") return this.newPairingCode();
      if (p === "/api/live/devices" && request.method === "GET") return json(await this.deviceList());
      if (p.startsWith("/api/live/devices/") && request.method === "DELETE") return this.removeDevice(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/cameras/") && request.method === "PATCH") return this.updateCamera(decodeURIComponent(p.split("/").pop()), request);
      if (p.startsWith("/api/live/cameras/") && request.method === "DELETE")
        return this.removeCamera(decodeURIComponent(p.split("/").pop()), url.searchParams.get("permanent") === "1");
      if (p === "/api/live/streams" && request.method === "POST") return this.addStream(request);
      if (lay && request.method === "POST" && !lay[2]) return this.createLayout(decodeURIComponent(lay[1]), request);
      if (lay && request.method === "POST" && lay[3]) return this.activateLayout(decodeURIComponent(lay[1]), Number(lay[2]));
      if (lay && request.method === "DELETE" && lay[2] && !lay[3]) return this.deleteLayout(decodeURIComponent(lay[1]), Number(lay[2]));
      if (p === "/api/live/privacy" && request.method === "PUT") return this.setPrivacy(request, user);
      const day = p.match(/^\/api\/live\/day\/(\d{4}-\d{2}-\d{2})$/);
      if (day && request.method === "DELETE") return this.deleteDay(day[1], url.searchParams.get("tz") || "UTC", user);
      const undo = p.match(/^\/api\/live\/day\/(\d{4}-\d{2}-\d{2})\/restore$/);
      if (undo && request.method === "POST") return this.restoreDay(undo[1], user);
      if (p === "/api/live/counting" && request.method === "PUT") return this.setCounting(request);
      if (p === "/api/live/find-cameras" && request.method === "POST") return this.findCameras();
      if (p === "/api/live/find-cameras" && request.method === "GET") return json(await this.foundCameras());
      if (p === "/api/live/find-cameras/add" && request.method === "POST") return this.addFound(request);
      if (p.startsWith("/api/live/find-cameras/add/") && request.method === "GET") return json(await this.addStatus(decodeURIComponent(p.split("/").pop())));
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Error" }, 500);
    }
  }

  // ── Pairing ────────────────────────────────────────────────────────────────

  async newPairingCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    const expires = Date.now() + 30 * 60_000;
    await this.ctx.storage.put(`pair:${code}`, { expires });
    return json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_at: new Date(expires).toISOString() });
  }

  async pair(request) {
    const body = await request.json().catch(() => ({}));
    const code = clean(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const entry = await this.ctx.storage.get(`pair:${code}`);
    if (!entry || entry.expires < Date.now()) return json({ error: "That code isn't valid or has expired — get a new one on the Cameras page" }, 403);
    await this.ctx.storage.delete(`pair:${code}`);
    const id = `box-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const devices = await this.get("devices", {});
    devices[id] = {
      id, name: clean(body.name, 60) || "Camera computer", platform: clean(body.platform, 40),
      token_hash: await sha256(token), paired_at: new Date().toISOString(), last_seen: null, version: clean(body.version, 20),
    };
    await this.ctx.storage.put("devices", devices);
    return json({ device_id: id, token });
  }

  async registerBrowser(request) {
    const body = await request.json().catch(() => ({}));
    const id = `web-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const devices = await this.get("devices", {});
    // Every Camera Mode browser adds an entry. Without a limit the device list
    // eventually outgrows one stored value and then EVERY camera report fails,
    // so drop ones that haven't counted for a day, then the oldest beyond the cap.
    const web = Object.values(devices).filter((d) => d.id.startsWith("web-"));
    const stale = (d) => Date.now() - Date.parse(d.last_seen || d.paired_at) > 24 * 3600_000;
    for (const d of web) if (stale(d)) delete devices[d.id];
    const left = Object.values(devices).filter((d) => d.id.startsWith("web-"))
      .sort((a, b) => Date.parse(b.last_seen || b.paired_at) - Date.parse(a.last_seen || a.paired_at));
    for (const d of left.slice(MAX_WEB_DEVICES - 1)) delete devices[d.id];
    devices[id] = {
      id, name: clean(body.name, 60) || "Camera mode", platform: "Web browser",
      token_hash: await sha256(token), paired_at: new Date().toISOString(), last_seen: null, version: clean(body.version, 20),
    };
    await this.ctx.storage.put("devices", devices);
    return json({ device_id: id, token });
  }

  async withDevice(request, fn) {
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Not paired" }, 401);
    const hash = await sha256(token);
    const devices = await this.get("devices", {});
    const device = Object.values(devices).find((d) => d.token_hash === hash);
    if (!device) return json({ error: "This camera computer was removed — pair it again" }, 401);
    return fn(device);
  }

  async deviceList() {
    const devices = await this.get("devices", {});
    const cams = await this.get("cameras", {});
    return Object.values(devices).map((d) => ({
      id: d.id, name: d.name, platform: d.platform, version: d.version, paired_at: d.paired_at, last_seen: d.last_seen,
      online: !!d.last_seen && Date.now() - Date.parse(d.last_seen) < OFFLINE_AFTER_MS,
      cameras: Object.values(cams).filter((c) => c.device_id === d.id && !c.hidden).length,
    }));
  }

  async removeDevice(id) {
    const devices = await this.get("devices", {});
    if (!devices[id]) return json({ error: "No such camera computer" }, 404);
    delete devices[id];
    await this.ctx.storage.put("devices", devices);
    return json({ removed: true });
  }

  // ── Reports from the camera computer ──────────────────────────────────────

  async report(device, request) {
    const body = await request.json().catch(() => ({}));
    const now = Date.now();
    const cams = await this.get("cameras", {});
    const live = await this.get("live", {});
    const newQuestions = [];
    // Face matching runs only while a service is being recorded (and only if switched on).
    // Asked every time, not only when the switch is flipped: switching face
    // matching off has to stop the processing then, not at the next time
    // somebody visits a settings page.
    const mayReadFaces = await this.facesAllowed();
    const faceOn = mayReadFaces && !!(await this.get("service_live", null));
    /**
     * Which service is being recorded, if one is.
     *
     * Two things written here belong to a service and must not outlive one:
     * the doorway's record of who it has counted, and the questions about
     * chairs. Both referred to a `service` that was never declared in this
     * function — a ReferenceError on EVERY report, which the browser saw as
     * "the website didn't accept the counts (500)" and nothing was saved at
     * all until it cleared.
     *
     * It was three lines below in spirit and nowhere in fact: faceOn above
     * reads the same value and throws it away.
     */
    const service = (await this.get("service_live", null))?.id ?? null;
    if (!faceOn) this.faceCodes.clear();
    // Each camera's arrivals and departures added up over time, rather than
    // whatever its browser's own tally happens to read right now. See below.
    const counters = await this.get("counters", {});
    let changed = false, countersChanged = false;
    /** Cameras that said goodbye in this report. See the end of this method. */
    const stopped = [];
    /** Counters that started again, and what was deliberately not counted
     *  because of it. Written to the audit trail below. */
    const countReset = [];
    /** Cameras whose browser has just started again, so they have forgotten
     *  who they already counted and need it back. See door_known. */
    const handBackRemembered = new Set();
    /** Chairs a camera has found and cannot settle. See seat_asks. */
    const seatAsks = [];

    for (const c of Array.isArray(body.cameras) ? body.cameras.slice(0, 32) : []) {
      const key = clean(c.key, 80);
      if (!key) continue;
      const camera_id = `${device.id}:${key}`;
      // Network cameras only exist once an admin adds them on the website; a
      // report for one that was just removed must not bring it back.
      if (!cams[camera_id] && !key.startsWith("usb-") && !key.startsWith("web-")) continue;
      if (!cams[camera_id]) {
        // A newly plugged-in camera (camera computer or Camera mode): add it with sensible defaults.
        const n = Object.keys(cams).length + 1;
        const label = clean(c.label, 60);
        const kind = clean(c.kind, 10) || "usb";
        cams[camera_id] = {
          camera_id, device_id: device.id, key, kind, label,
          name: label || `Camera ${n}`, zone_name: label || `Camera ${n}`,
          zone_capacity: 0, zone_order: n, location: "indoor", hidden: false, created_at: new Date(now).toISOString(),
          // A camera plugged into a camera computer waits for an admin to say
          // "yes, add it" (the website asks). Camera Mode cameras were started on purpose.
          pending: kind === "usb",
        };
        // The same camera moved from another computer? It keeps its name, room, seats and history — no need to ask.
        const old = this.movedFrom(cams, live, camera_id, device.id, label);
        if (old) { await this.takeOver(cams, live, old, camera_id); cams[camera_id].pending = false; }
        changed = true;
      }
      this.seenAt.set(camera_id, now);
      if (cams[camera_id].hidden || cams[camera_id].pending || c.status === "standby") continue;
      // Counting was switched off on that computer, and it said so on its way
      // out instead of simply going quiet.
      //
      // Going quiet took forty-five seconds to notice, and for those
      // forty-five seconds the Live Cameras page showed the last picture that
      // camera sent, in colour, under a pulsing green "Live". The picture is
      // the most convincing thing on the screen. So: offline at once, and the
      // picture is thrown away — a camera that is off has no picture of now,
      // and keeping yesterday's is how a page lies to somebody.
      if (c.status === "offline") {
        /**
         * …and tell the phones, which the Notifications page has promised
         * since it was written.
         *
         * It lists "Camera went offline — a camera stopped sending data",
         * with a switch beside it. Nothing anywhere has ever sent one. A
         * camera stopping mid-service is the most useful thing a phone
         * could say, and it was the one thing it could not.
         *
         * Only when it was actually counting a moment ago: a camera that is
         * already off does not go off again, and a report full of offline
         * cameras at the end of a service is somebody pressing stop.
         */
        if (live[camera_id] && live[camera_id].status !== "offline" && this.isOnline(live[camera_id])) {
          this.ctx.waitUntil(notifyCount(this.env, {
            kind: "offline", zone: cams[camera_id]?.zone_name || cams[camera_id]?.name || "A camera", count: 0,
          }).catch(() => {}));
        }
        live[camera_id] = { ...(live[camera_id] ?? {}), current: 0, status: "offline", updated_at: now };
        await this.ctx.storage.delete(`snap:${camera_id}`);
        // It is not failing: it is off. Nothing is left to report that it is
        // working again, so its problems are closed here instead.
        await this.working(cams[camera_id].name);
        if (cams[camera_id].label) await this.working(cams[camera_id].label);
        changed = true;
        stopped.push(camera_id);
        continue;
      }
      // Running totals that survive the counting browser being reloaded.
      //
      // A browser reports its own tally since IT started, so a reload put the
      // live arrivals back to nothing while the chart — which adds up the
      // steps between readings — carried on from where it was. That is how the
      // headline came to read 18 with 1,271 arrivals on the card below it.
      // Only the step between two readings is people moving; a reading lower
      // than the last one means that counter started again.
      const seen = counters[camera_id] ?? { in: 0, out: 0, lastIn: null, lastOut: null, people: 0, lastPeople: null };
      const rIn = num(c.entries, 0, 10000000), rOut = num(c.exits, 0, 10000000);
      const rPeople = num(c.people_seen, 0, 10000000);
      /**
       * Only ever the step FORWARD, and nothing at all when a counter starts
       * again.
       *
       * ── The bug this was ───────────────────────────────────────────────
       *
       * "how is there 1 person on the camera and 6 came in ... now theres 8
       * that came in meanwhile i didnt even move".
       *
       * A browser reports its own running total since IT started. When that
       * total comes back LOWER than last time, the browser restarted — a
       * reload, a camera reconnect, a tab reopened. This then added the
       * WHOLE of the new total as arrivals, on the reasoning that it was all
       * new since the restart.
       *
       * It is not. A fresh tracker confirms everybody already standing in
       * front of the camera within a second or two, and those people did not
       * arrive — they were already there. So every reload counted the room
       * again. Reload twice with one person in shot and "came in" goes up by
       * two, with nobody moving at all. Over an evening of testing that is
       * exactly how 0 became 6 became 8.
       *
       * The same applies to the very first report Kyro ever sees from a
       * camera: whatever it has counted up to that moment happened before
       * anybody was watching, and is not arrivals since now.
       *
       * The cost is any genuine arrival in the second or two between a
       * restart and its first report. That is a handful of people a year.
       * The alternative is the room counted again every time a tab is
       * reloaded, which is not a cost, it is a wrong answer.
       */
      const restarted = seen.lastIn !== null && (rIn < seen.lastIn || rOut < seen.lastOut);
      const first = seen.lastIn === null;
      const step = (now, last) => (first || restarted || now < last ? 0 : now - last);
      seen.in += step(rIn, seen.lastIn);
      seen.out += step(rOut, seen.lastOut);
      seen.people = (seen.people || 0) + step(rPeople, seen.lastPeople ?? 0);
      // Why a figure was or wasn't accepted, kept where it can be read. A
      // counter that starts again is the commonest reason a number does not
      // move, and it used to be the commonest reason one moved wrongly.
      if (restarted || first) {
        countReset.push({
          camera_id, at: now, reason: first ? "first report from this camera" : "its counter started again",
          not_counted: { in: rIn, out: rOut, people: rPeople },
        });
        /**
         * …and this is the moment to hand the doorway its memory back.
         *
         * A counter that has started again is a browser that has started
         * again — a reload, a reopened tab, a camera reconnecting — which is
         * precisely when it has forgotten who it had already counted. It is
         * the only moment worth sending a morning's worth of people over the
         * wire, and the only moment it is any use.
         */
        handBackRemembered.add(camera_id);
      }
      seen.lastIn = rIn; seen.lastOut = rOut; seen.lastPeople = rPeople;
      counters[camera_id] = seen;
      countersChanged = true;
      live[camera_id] = {
        current: num(c.current, 0, 100000), peak: num(c.peak, 0, 100000),
        entries: seen.in, exits: seen.out, people: seen.people || 0,
        status: ["online", "error", "offline"].includes(c.status) ? c.status : "online",
        // What the picture is actually like. Kept separately from whether the
        // camera is connected, because a connected camera sending black is
        // not a working camera.
        black: !!c.black, frozen: !!c.frozen, no_picture: !!c.no_picture,
        counted_at: num(c.counted_at, 0, Date.now() + 60_000) || now,
        error_reason: c.error ? clean(c.error, 120) : null, fps: Number(c.fps) || 0,
        // The middle time a person stays in this camera's view, in seconds.
        // How a camera set as a room but pointed at a door is spotted — see
        // DOORWAY_LIFE_S.
        life_s: num(c.life_s, 0, 100000) || null,
        // What this camera would be counting at either end of the Counting
        // sensitivity setting. Read by suggestSensitivity and by nothing
        // else: they are not a count of anybody.
        at_sensitive: num(c.at_sensitive, 0, 10000),
        at_careful: num(c.at_careful, 0, 10000),
        width: num(c.width, 0, 10000), height: num(c.height, 0, 10000), updated_at: now,
      };
      /**
       * The doorway's record of who it has already counted, kept here.
       *
       * ── Why it cannot live in the browser ────────────────────────────────
       *
       * "if it reloads, does it mean face recognition will not know the
       * previous?" … "yes fix it, keep the list on the website."
       *
       * The faces themselves were always here. This list was not: it is the
       * DOOR's own record of who it has counted, and it was rebuilt from
       * nothing on every page load. So the usher who is in and out all
       * morning was counted again after every reload — and today was a day
       * of reloads, which is a day of inflation that looks exactly like a
       * busy door.
       *
       * Only what the camera has newly learned arrives each time, so this is
       * a handful of people rather than the morning. It belongs to the
       * service, like the faces, and goes when the service does.
       */
      if (service && Array.isArray(c.remembered) && c.remembered.length) {
        const key = `door_known:${camera_id}`;
        const had = (await this.get(key, null)) ?? { service, people: [] };
        // A different service is a different congregation; nothing carries.
        const list = had.service === service ? had.people : [];
        for (const k of c.remembered.slice(0, 25)) {
          if (!k || typeof k !== "object") continue;
          list.push({
            l: Array.isArray(k.l) && k.l.length === 8 ? k.l.map(Number) : null,
            // A face only ever travels, or is kept, while face matching is on.
            // In this function it is faceOn; faceOk is the same question
            // asked in rememberPeople, and using that name here was a
            // ReferenceError on every report that carried one of these.
            f: faceOn && typeof k.f === "string" ? k.f : null,
            i: k.i ? 1 : 0, o: k.o ? 1 : 0, u: k.u ? 1 : 0,
            at: num(k.at, 0, Date.now() + 60_000) || now,
          });
        }
        // The same ceiling the browser keeps, so what comes back always fits.
        if (list.length > MOST_DOOR_REMEMBERED) list.splice(0, list.length - MOST_DOOR_REMEMBERED);
        await this.ctx.storage.put(key, { service, people: list });
      }
      /**
       * Chairs Kyro has found and cannot settle, turned into questions.
       *
       * "kyro should be able to recognise what a chair is though and when
       * people are sitting down and where a chair is, thats why it should
       * ask questions, which has not been doing completely."
       *
       * It does recognise them — chairs, benches and sofas come out of the
       * same AI run that finds people — and it already marks the ones it
       * cannot settle. On a camera computer those were asked about with a
       * photograph. In Camera Mode nothing ever asked: they sat in the seat
       * map waiting to be noticed, which is not the same thing, and is why
       * she has never once been shown one.
       *
       * One question per seat, never asked twice, and the answer travels
       * back to the camera that found it — the camera is the only thing
       * that knows where its seats are.
       */
      if (service && Array.isArray(c.seat_asks) && c.seat_asks.length) {
        for (const a of c.seat_asks.slice(0, 4)) {
          const seat = num(a?.id, 1, 100000);
          if (!seat) continue;
          seatAsks.push({ camera_id, key, seat });
        }
      }
      if (Array.isArray(c.questions) && c.questions.length) newQuestions.push(...c.questions.slice(0, 10).map((q) => cleanQuestion(q, camera_id)).filter(Boolean));
      if (Array.isArray(c.faces) && faceOn) {
        this.faceCodes.set(camera_id, { at: now - Math.min(30, Number(c.faces_age_s) || 0) * 1000, codes: c.faces.slice(0, 250).map(unpackFace).filter(Boolean) });
      }
      // What this camera decided at the door, kept briefly so somebody can
      // check Kyro against what they can see with their own eyes. A time and
      // one word each — nothing about who anyone is.
      if (Array.isArray(c.events) && c.events.length) {
        const log = this.doorLog.get(camera_id) ?? [];
        for (const e of c.events.slice(-30)) {
          const kind = ["in", "out", "again-in", "again-out", "unclear"].includes(e.kind) ? e.kind : null;
          if (kind) log.push({ at: num(e.at, 0, Date.now() + 60_000) || now, kind });
        }
        this.doorLog.set(camera_id, log.slice(-DOOR_LOG_KEEP));
      }
      if (Array.isArray(c.seats)) {
        // Its own key, and its own try/catch: seat colours are cosmetic, the count is not.
        try {
          await this.ctx.storage.put(`seat_live:${camera_id}`,
            { at: now, seats: c.seats.slice(0, MAX_SEATS).map(cleanSeatState).filter(Boolean) });
        } catch (e) {
          // The seat map silently stopped updating for this camera. Said out
          // loud, with the camera's name, because the map still LOOKS fine:
          // it goes on showing the last states it managed to store.
          await this.wrong(`Seat map · ${cams[camera_id]?.name || camera_id}`,
            "Couldn't store which seats are taken — the seat map for this camera is frozen at its last good reading",
            e && e.message);
        }
      }
      if (now - (this.lastSample.get(camera_id) ?? 0) >= SAMPLE_EVERY_MS) {
        this.lastSample.set(camera_id, now);
        const l = live[camera_id];
        // Columns named explicitly: the table gained deleted_at, and an unnamed
        // INSERT then fails — which would stop every camera being recorded.
        this.ctx.storage.sql.exec("INSERT INTO history (ts, camera_id, current, entries, exits, capacity, people) VALUES (?, ?, ?, ?, ?, ?, ?)",
          now, camera_id, l.current, l.entries, l.exits, cams[camera_id].zone_capacity || 0, l.people || 0);
      }
    }

    // Whatever went wrong in the browser doing the counting. It is the half of
    // Kyro nobody can see from here, and until now its failures stayed in a
    // console log on a computer at the back of a hall.
    if (Array.isArray(body.problems)) {
      for (const pr of body.problems.slice(0, 10)) {
        if (!pr || typeof pr.what !== "string") continue;
        await this.wrong(clean(pr.where, 60) || "Counting computer", clean(pr.what, 200), clean(pr.detail, 200));
      }
    }
    // And — the half that was missing — which of its cameras are fine NOW.
    //
    // Without this, one black frame at any point in a camera's life left a red
    // line on the page that nothing could ever clear: the browser said when a
    // camera went wrong and never said when it came right, and the rule here
    // is that only the thing working again clears a problem. A camera that is
    // open, showing a changing, non-black picture and counting is that thing
    // working again, so it says so every half minute.
    if (Array.isArray(body.well)) {
      for (const w of body.well.slice(0, 32)) {
        const where = clean(w, 60);
        if (where) await this.working(where);
      }
    }
    // The counting browser couldn't load the face AI. Kept so the Face
    // matching card can say so rather than looking switched on and idle.
    // The face AI is loaded in that browser and looking at every count —
    // which is the real answer to "is face matching working". Whether it found
    // a face just now depends on whether anyone was facing a camera, and that
    // is not a fault.
    if (body.faces_ready) await this.ctx.storage.put("face_ready_at", now);
    if (typeof body.faces_error === "string" && body.faces_error) {
      await this.ctx.storage.put("face_error", { at: now, message: clean(body.faces_error, 160), device: device.id });
    } else if (body.faces_error === null && await this.get("face_error", null)) {
      await this.ctx.storage.delete("face_error");
    }
    if (countersChanged) await this.ctx.storage.put("counters", counters);
    // The audit trail: every time Kyro declined to carry a counter forward,
    // with the camera, the moment and exactly what was not counted. Asked
    // for in so many words — "preserve an audit trail showing exactly why
    // every entry was accepted or rejected" — and it is the one thing that
    // makes a figure checkable after the fact rather than merely plausible.
    if (countReset.length) {
      const trail = await this.get("count_audit", []);
      for (const r of countReset) trail.unshift({ ...r, at: new Date(r.at).toISOString() });
      await this.ctx.storage.put("count_audit", trail.slice(0, 200));
    }
    // The register of people. Every camera's observations meet here, which is
    // the only place they can be compared with each other.
    try {
      await this.rememberPeople(device, body, cams, now);
      // Anybody nobody has seen for five minutes has left, and it is written
      // down at the moment they were last seen rather than the moment Kyro
      // became sure of it. See closeDeparted in worker/identity.js.
      this.register?.closeDeparted?.(now, LEFT_AFTER_MS);
      await this.working("Register of people");
      /**
       * Nothing is watching a room.
       *
       * "both cameras are set as entrance and exit."
       *
       * A camera on a doorway answers "who went through". It cannot answer
       * "how many are in the hall", it has no seats, and it cannot hold a
       * seat count — so a building whose cameras are ALL on doorways
       * silently loses the seat count, the room count, how full it is, the
       * filling-up alerts, and every sanity check that rests on them. Kyro
       * went on reporting a confident attendance figure throughout, with
       * nothing left able to contradict it.
       *
       * It is a two-click fix and it was invisible for an entire service,
       * which is the only reason this is here. Said once, cleared the moment
       * a camera is pointed at a room.
       */
      /**
       * A camera set as a room that is really pointed at a door.
       *
       * ── Why this cannot be left to a setting ────────────────────────────
       *
       * A doorway camera and a room camera want opposite treatment, and
       * which one a camera is, is a tick-box somebody has to get right. Get
       * it wrong this way round and nothing says so: the camera is open,
       * healthy, sending a perfect picture — and putting a NEW PERSON in the
       * register for everybody who walks past it, because that is what a
       * room camera is for. One person crossing a doorway appears,
       * disappears and reappears; as a "room" they are three people, and by
       * the end of a morning a hall of 114 chairs has 300 people in it.
       *
       * The camera itself can tell. People are in a doorway's view for a few
       * seconds and in a hall's for an hour — see typicalLifeS. So Kyro
       * measures it and says so, with the one tick-box that fixes it, rather
       * than waiting for somebody to suspect the setting.
       */
      for (const c of Object.values(cams)) {
        if (!c || c.hidden || c.pending) continue;
        if (c.location === "entrance" || c.location === "queue") continue;
        const life = live[c.camera_id]?.life_s;
        if (!(life > 0) || life > DOORWAY_LIFE_S) { await this.working(`${c.name || c.camera_id} is watching a room`); continue; }
        await this.wrong(`${c.name || c.camera_id} is watching a room`,
          `People are only in ${c.name || c.camera_id}'s view for about ${Math.round(life)} seconds, which is a doorway, not a room.`,
          "Set as a room, it puts a NEW person in the register for everybody who walks past — and one person crossing a doorway "
          + "appears, disappears and reappears, so they are counted several times. On the Cameras page, open this camera with the "
          + "pencil and set its location to the entrance. It will then count people in and out and leave the register alone.");
      }
      const anyRoom = Object.values(cams).some(
        (c) => c && !c.hidden && !c.pending && c.location !== "entrance" && c.location !== "queue");
      if (!anyRoom && Object.values(cams).some((c) => c && !c.hidden && !c.pending)) {
        await this.wrong("Cameras",
          "Every camera is set as a doorway, so nothing is watching the room itself.",
          "A doorway camera counts people through a door; it has no seats and cannot say how full the hall is. "
          + "On the Cameras page, open the camera pointed at the congregation and set its location to the indoor "
          + "option. Seats, how full the room is and the filling-up alerts all come back on.");
      } else if (anyRoom) {
        await this.working("Cameras");
      }
    } catch (e) {
      // This is the serious one. With the register gone, attendance falls back
      // to each camera's own tally, which counts the same congregation over
      // and over — the number on the screen does not change appearance, it
      // changes MEANING. Nobody may be left to find that out for themselves.
      await this.wrong("Register of people",
        "Couldn't record who is here, so the attendance figure has fallen back to each camera's own count — which counts the same people repeatedly and will read far too high",
        e && e.message);
    }
    const devices = await this.get("devices", {});
    if (devices[device.id]) {
      devices[device.id].last_seen = new Date(now).toISOString();
      if (body.version) devices[device.id].version = clean(body.version, 20);
      await this.ctx.storage.put("devices", devices);
    }
    if (changed) await this.ctx.storage.put("cameras", cams);
    await this.ctx.storage.put("live", live);
    /**
     * "This room is filling up" / "This room is full", to people's phones.
     *
     * ── Why this line is new ──────────────────────────────────────────────
     *
     * It was written, commented, guarded against buzzing everybody's phone
     * every thirty seconds, and never called from anywhere. The alerts have
     * never once gone out. Found the same way the faces were: by asking
     * which methods nothing in the running code refers to.
     *
     * Here, because this is the moment the live figures have just been
     * written and `cams` and `live` are both in hand and both current.
     * Anything it fails on is its own business — a phone alert that cannot
     * be sent must never cost a report that can.
     */
    try { await this.capacityAlerts(cams, live); } catch { /* an alert is not worth a report */ }
    // The last camera anywhere has been switched off, so the session is over.
    //
    // "When I end my session or camera, this should all be refreshed too."
    // Nothing more can be counted once the last camera stops, so the figures
    // on the screen stop being a description of now and become a description
    // of earlier — under a heading that says "this session". The service is
    // written into the record and the session's figures go back to zero.
    //
    // Only when NOTHING is left counting, anywhere: stopping one camera of
    // three, or reloading the page on a second computer, must not end a
    // service that is still being counted somewhere else.
    // More people counted than the building holds. See over_capacity.
    try {
      const v = await this.venueTotal();
      if (v.over_capacity) {
        await this.wrong("Counting",
          `The cameras are counting ${v.over_capacity.counted} people in a building set to hold `
          + `${v.over_capacity.seats}. Something is being counted that is not a person, or somebody is `
          + `being counted twice — check the green boxes on the Cameras page.`,
          `${v.over_capacity.counted} of ${v.over_capacity.seats}`);
      } else {
        await this.working("Counting");
      }
    } catch { /* the check is a bonus; never the thing that stops a report */ }

    const lastCameraOff = stopped.length > 0 && !this.anyCameraOn(cams, live, now);
    try {
      // Ending the session is itself the service decision for this report —
      // trackService would only look at an empty room and reach the same
      // conclusion more slowly.
      if (lastCameraOff) await this.endSession(now);
      else await this.trackService(now);
      await this.working("Services");
    } catch (e) {
      await this.wrong("Services",
        "Couldn't follow whether a service is running, so one may fail to start, fail to end, or record the wrong busiest figure",
        e && e.message);
    }

    // Tell the box which cameras it may use (added on the website) and which not.
    const mine = Object.values(cams).filter((c) => c.device_id === device.id && c.kind !== "network");
    const allowed = mine.filter((c) => !c.hidden && !c.pending).map((c) => c.key);
    const off = mine.filter((c) => c.hidden || c.pending).map((c) => c.key);
    const urls = await this.get("streams", {});
    const streams = Object.values(cams)
      .filter((c) => c.device_id === device.id && c.kind === "network" && !c.hidden && urls[c.camera_id])
      .map((c) => ({ key: c.key, url: urls[c.camera_id] }));
    // "Don't count this area" (e.g. a statue), per camera, as 0–1 fractions of the picture.
    const ignore_zones = Object.fromEntries(Object.values(cams)
      .filter((c) => c.device_id === device.id && c.ignore_zones?.length).map((c) => [c.key, c.ignore_zones]));
    // Requests waiting for this computer ("Find cameras", "Add this camera").
    const jobs = await this.jobsFor(device.id);
    if (newQuestions.length) await this.addQuestions(newQuestions);
    // "Is this the same person?" — the register's own guesses, turned into
    // questions somebody can answer from two pictures. See askAbout in
    // worker/identity.js and makeAsks below.
    const wantPictures = await this.makeAsks(cams, now);
    // …and the chairs, which ask the same way and want the same picture.
    if (seatAsks.length) wantPictures.push(...(await this.askAboutSeats(seatAsks, cams, now)));
    // …and "is this the same chair?", which needs a picture from each of the
    // two cameras that disagree about it.
    try {
      wantPictures.push(...(await this.askAboutSameChair(cams, now)));
    } catch (e) {
      await this.wrong("Seating",
        "Couldn't ask which chairs are the same chair, so one chair seen by two cameras may be counted twice",
        e && e.message);
    }
    // Answers to the AI's questions, for this computer's cameras (delivered once).
    const answers = await this.takeAnswers(device.id);
    // Rota holds and stage / ignore areas, per camera (small; sent every time).
    const rota = await this.get("rota", []);
    const zonesAll = await this.get("seat_zones", {});
    const rotaFor = {}, zonesFor = {};
    for (const c of Object.values(cams)) {
      if (c.device_id !== device.id) continue;
      const r = rota.filter((e) => !e.camera_id || e.camera_id === c.camera_id);
      if (r.length) rotaFor[c.key] = r;
      if (zonesAll[c.camera_id]?.length) zonesFor[c.key] = zonesAll[c.camera_id];
    }
    // Which of this computer's cameras are watching a doorway, and which way
    // is "in". A camera on a door cannot tell arrivals from departures by
    // watching people appear and disappear — everyone does both — so the
    // counter needs to know to go by the direction they walked instead.
    const doorways = {};
    for (const c of Object.values(cams)) {
      if (c.device_id !== device.id || c.location !== "entrance") continue;
      doorways[c.key] = ["closer", "away", "left", "right"].includes(c.inward) ? c.inward : "closer";
    }
    // Seat layouts: only a version number each time; the box fetches a layout when it changes.
    const seat_layouts = {};
    for (const c of Object.values(cams)) {
      if (c.device_id !== device.id) continue;
      const a = (await this.layoutsOf(c.camera_id)).find((l) => l.is_active);
      if (a) seat_layouts[c.key] = `${a.id}.${a.version ?? 0}`;
    }
    return json({ ok: true, allowed, disabled: off, streams, ignore_zones, jobs, seat_layouts, answers, rota: rotaFor, seat_zones: zonesFor, doorways,
      // Crops of particular people Kyro wants a human to look at. Only ever
      // for this computer's own cameras, and only while the question is
      // waiting — see ASK_PICTURE_WAIT_MS.
      /**
       * The doorway's record of who it has already counted, handed back to a
       * browser that has just started again. See door_known.
       *
       * Sent only at that moment, and only for the cameras that restarted:
       * it is a morning's worth of people, and there is no point sending it
       * to a browser that already has it.
       */
      remembered: await (async () => {
        const out = {};
        for (const camera_id of handBackRemembered) {
          if (!camera_id.startsWith(`${device.id}:`)) continue;
          const had = await this.get(`door_known:${camera_id}`, null);
          if (!had || had.service !== service || !had.people?.length) continue;
          out[camera_id.slice(device.id.length + 1)] = faceOn
            ? had.people
            // Face matching switched off since: the coats may come back, the
            // faces may not.
            : had.people.map((k) => ({ ...k, f: null }));
        }
        return out;
      })(),
      want_pictures: wantPictures.filter((w) => w.camera_id.startsWith(`${device.id}:`))
        .map((w) => ({ id: w.id, side: w.side, key: w.camera_id.slice(device.id.length + 1),
          track: w.track, ...(w.seat ? { seat: w.seat } : {}), ...(w.who ? { who: true } : {}) })),
      face_matching: faceOn, count_confidence: (await this.counting()).count_confidence,
      // When a fresh start was last asked for. A counter that hasn't applied
      // this one yet puts its arrivals and departures back to zero — so "Start
      // fresh" pressed on a phone reaches the computer doing the counting.
      count_from: await this.get("count_from", 0),
      /**
       * How many of this computer's sightings right now are the same person
       * seen by two of its cameras.
       *
       * The card on the Cameras page adds its cameras together, which is the
       * one thing a camera cannot do for itself: two cameras pointed at one
       * face said "2 people now". The register can tell — it is the only
       * part of Kyro that sees every camera at once — so it tells the
       * browser, and the browser takes it off its own total.
       */
      seen_twice: this.register
        ? this.register.seenNow(new Set(Object.values(cams)
            .filter((c) => c.device_id === device.id && c.location !== "entrance" && !c.hidden)
            .map((c) => c.camera_id))).duplicates
        : 0,
      /**
       * Which person in the register each of this computer's sightings
       * turned out to be.
       *
       * ── Why ──────────────────────────────────────────────────────────────
       *
       * "theres one that has been standing for more than 5 minutes an usher,
       * but you have given him different Id's, one time he was 20036, next
       * hes 20057, next hes 2045, dont understand."
       *
       * She is reading the number drawn on the picture as that person's
       * identity. It never was one. It is the camera's own scratch number
       * for a box it is following — it is thrown away and reissued every
       * time the detector loses somebody for a moment, which in a hall is
       * constantly, and the number it starts from moves on by ten thousand
       * on every reload so two browsers can't collide. 20036 then 20057 then
       * 2045 is that number working exactly as designed, and it is useless
       * as an answer to "who is that".
       *
       * The identity is the register's, it is decided here, and it is locked
       * for the whole service. So it is sent back to the browser doing the
       * counting, and the picture shows THAT — the number Kyro counts him
       * as. One usher standing by the door for twenty minutes is one number
       * that does not change, and if it does change, something is wrong and
       * she can see it happen.
       *
       * Built after rememberPeople() has run, so it describes the sightings
       * in THIS report rather than the one before it.
       */
      people: (() => {
        const out = {};
        if (!this.register) return out;
        for (const c of Array.isArray(body.cameras) ? body.cameras.slice(0, 32) : []) {
          const key = clean(c.key, 80);
          if (!key || !Array.isArray(c.seen)) continue;
          const camera_id = `${device.id}:${key}`;
          const mine = {};
          for (const x of c.seen.slice(0, 40)) {
            const t = Number(x.t) || 0;
            const id = this.register.idOfTrack(camera_id, t);
            if (id) mine[t] = id;
          }
          if (Object.keys(mine).length) out[key] = mine;
        }
        return out;
      })(),
      // "auto" = work out which way each person went. "in"/"out" = an operator
      // has said everybody crossing is arriving, or leaving.
      door_mode: (await this.get("door_mode", null))?.mode ?? "auto",
      // Which service is being recorded, if one is. The counting browser
      // remembers people for as long as one service runs — so the usher
      // holding the door isn't counted in forty times — and forgets every one
      // of them when this changes. Between services that memory would measure
      // the evening congregation against the morning's, and keeping it would
      // make Kyro a record of people rather than a count of them.
      service: (await this.get("service_live", null))?.id ?? null,
      report_every_s: 2, snapshot_every_s: 20 });
  }

  /**
   * Add what the cameras have just seen to the register of people.
   *
   * Everything that makes this safe is in identity.js; this is the plumbing:
   * which service we are in, which camera is on a doorway (a doorway may
   * recognise people but never invent them), and writing the register down
   * now and then so a restart doesn't lose the congregation.
   */
  async rememberPeople(device, body, cams, now) {
    const live = await this.get("service_live", null);
    const service = live?.id ?? null;
    if (!this.register) {
      this.register = new IdentityRegistry({
        zoneOf: (id) => (cams[id]?.zone_name || cams[id]?.name || id),
        createsIdentities: (id) => cams[id]?.location !== "entrance",
        /**
         * Can these two cameras see the same spot?
         *
         * "Different room" is a veto: somebody on a camera at one end of the
         * building cannot be on a camera at the other end a second later, so
         * that candidate is skipped and a new person is created instead.
         *
         * A camera that adds itself gets a room named after itself, because
         * nothing else is known about it yet. Two cameras plugged into one
         * computer therefore counted as two different rooms — and one person
         * sitting in front of both was two people, every time, with the veto
         * guaranteeing they could never be joined up again. That is where
         * half of "31 different people" came from.
         *
         * A USB cable is two metres long. Two cameras on one computer are in
         * one place, until somebody says which rooms they watch. Getting this
         * wrong the generous way only means the veto doesn't fire and the
         * face and the coat are left to decide, which they are good at;
         * getting it wrong the strict way duplicates somebody for ever.
         */
        overlapping: (a, b) => {
          if (a === b) return true;
          const ca = cams[a], cb = cams[b];
          if (!ca || !cb) return false;
          if (ca.device_id && ca.device_id === cb.device_id) return true;
          return (ca.zone_name || ca.name || a) === (cb.zone_name || cb.name || b);
        },
        // One person in two cameras' seats at one moment: evidence that those
        // two seats are one chair. The building decides what to do with it,
        // and never merges anything without an administrator.
        onSameChair: (a, b) => { this.building?.sameChairEvidence(a, b, true); },
        // The line this church's own answers say is right, if it has given
        // Kyro enough of them. See askLearning() and ANSWERS_BEFORE_LEARNING.
        lookSame: (await this.get("look_same", null))?.value ?? LOOK_SAME,
      });
      const saved = await this.get("register", null);
      if (saved && saved.service === service) {
        this.register.restore(saved);
        /**
         * …and their FACES, which the snapshot deliberately does not hold.
         *
         * ── The bug this line is ──────────────────────────────────────────
         *
         * "do not delete any facial recognition right away, otherwise you
         * will forget their face and re count."
         *
         * She is describing something that was happening on every single
         * restart. Face codes are kept out of the register's snapshot on
         * purpose — they live in their own table so they can be deleted on
         * their own the moment a service ends — and restore() therefore
         * gives every person an empty list of faces. A method existed to put
         * them back. It was never called. Anywhere. The comment in
         * worker/identity.js even says "the worker puts them back here after
         * restoring — see loadFaces", and the worker did not.
         *
         * So the live-cameras server restarts mid-service — which it does on
         * every deploy, and did repeatedly during a service yesterday — and
         * the whole congregation's faces are forgotten while the people
         * themselves are kept. Everybody is then matched on the colour of
         * their coat alone, in a hall where fifty coats are navy, and the
         * register climbs. The face data was sitting in the table the whole
         * time, unread.
         *
         * Only while face matching is switched on: with it off there is
         * nothing in the table to read, and nothing may be read back.
         */
        if (await this.facesAllowed()) this.loadFaces(service, Date.now());
      } else this.register.startService(service);
    }
    // A different service — or none — means a different congregation. The
    // register is destroyed, faces and all, exactly as the face data is.
    if (this.register.service !== service) {
      this.register.startService(service);
      await this.ctx.storage.delete("register");
    }
    // Nothing is recorded outside a service: a register of people needs a
    // reason to exist, and "somebody left a camera running" is not one.
    if (!service) return;
    await this.theBuilding();     // so the register has somewhere to send evidence

    const faceOk = (await this.privacy()).face_matching;
    /**
     * Does the register already hold more people than the building can?
     *
     * Only the hub knows the seat count, so it tells the register, once a
     * report. From then on a new person is asked about rather than made in
     * silence — see `crowded` in worker/identity.js. Unknown seats mean
     * unknown, not crowded: a building nobody has given a seat count to is
     * not accused of being over-full.
     */
    try {
      const seats = await this.seatsInBuilding();
      this.register.crowded = seats > 0 && (this.register.size || 0) >= seats;
    } catch { this.register.crowded = false; }
    for (const c of Array.isArray(body.cameras) ? body.cameras.slice(0, 32) : []) {
      const key = clean(c.key, 80);
      if (!key || !Array.isArray(c.seen) || !c.seen.length) continue;
      // The camera's full name is the COMPUTER's id and the camera's key.
      // I first built it from a device_id in the report body, which isn't
      // there — the computer is identified by its token, not by what it says
      // about itself. The fallback would then have matched on the key alone,
      // and two computers each with a "usb-0" would have fed one another's
      // sightings into the same person.
      const camera_id = `${device.id}:${key}`;
      if (!cams[camera_id] || cams[camera_id].hidden || cams[camera_id].pending) continue;
      const id = camera_id;
      const obs = c.seen.slice(0, 40).map((x) => ({
        track: Number(x.t) || 0,
        look: Array.isArray(x.l) && x.l.length === 8 ? x.l.map(Number) : null,
        // A face only ever enters the register while face matching is switched
        // on, whatever a camera computer sends.
        face: faceOk && typeof x.f === "string" ? unpackFace(x.f) : null,
        // Which seat they are in, if any — context, never proof of who.
        seat: typeof x.s === "string" ? clean(x.s, 24) : null,
        // Where in the picture this sighting is, as four fractions of the
        // frame. Resolution-independent on purpose, so it goes on meaning
        // the same thing when a different camera is plugged in. It is how
        // somebody the detector lost for a moment is recognised as the
        // person who was sitting there — see SPOT_SAME in identity.js.
        box: Array.isArray(x.b) && x.b.length === 4 && x.b.every((v) => Number.isFinite(Number(v)))
          ? x.b.map((v) => Math.max(0, Math.min(1, Number(v))))
          : null,
        // How many seconds this box has not moved at all, when that is long
        // enough to be worth asking about. A seated person is never still;
        // a pillow, a coat over a chair or a poster is.
        stillFor: Number.isFinite(Number(x.q)) ? Math.max(0, Number(x.q)) : 0,
      })).filter((x) => x.look || x.face);
      if (obs.length) this.register.observe(id, obs, now);
    }

    if (now - this.registerSavedAt >= REGISTER_SAVE_MS) {
      this.registerSavedAt = now;
      // snapshot() leaves every face code behind on purpose: biometric data
      // stays in memory and dies with the process that holds it.
      //
      // A stored value is capped at 128 KB, and nine hundred people with five
      // appearance readings each is far more than that. Written as-is it
      // would throw, be swallowed by the caller's try/catch, and the register
      // would silently never be saved at all — so a restart mid-service would
      // start the congregation again from nobody, which is the exact failure
      // this is here to prevent. So it is trimmed until it fits: fewer
      // readings each first, then the oldest people lose their readings
      // altogether. They stay in the register and stay counted; they just
      // can't be recognised by appearance afterwards.
      await this.ctx.storage.put("register", this.register.snapshot(SAFE_VALUE_BYTES));
      // Faces go in their own table, one row each, so they can be deleted on
      // their own the moment the service ends.
      // Asked again here rather than trusted from earlier in the request:
      // writing face codes down is the thing the switch governs.
      // When each different person was first and last seen. Not biometric and
      // not optional: this is where attendance and arrivals come from once a
      // service is over. See the people table.
      this.savePeople(service);
      if (await this.facesAllowed()) this.saveFaces(service, now);
      else this.wipeFaces();
      // And whatever else happens — a service that never ended, a timer that
      // failed — nothing older than FACE_MAX_AGE_MS survives this line.
      this.wipeFaces(service, now);
    }
  }

  /**
   * One administrator's correction.
   *
   * Every change carries the version of the building it was made against, so
   * a second administrator working from a page opened ten minutes ago is told
   * to reload rather than silently undoing the first one's work.
   */
  async changeBuilding(request, user) {
    const b = await this.theBuilding();
    const body = await request.json().catch(() => ({}));
    const v = body.version;
    const id = clean(body.seat, 24), other = clean(body.other, 24);
    let out;
    switch (body.do) {
      case "confirm": out = b.confirm(id, user, v); break;
      case "reject":  out = b.reject(id, user, v); break;
      case "remove":  out = b.remove(id, user, v); break;
      case "restore": out = b.restore(id, user, v); break;
      case "merge":   out = b.merge(id, other, user, v); break;
      case "split":   out = b.split(id, other, user, v); break;
      case "move":    out = b.move(id, user, v, { place: body.place, camera: clean(body.camera, 80) || undefined, bbox: body.bbox }); break;
      case "add":     out = b.add(user, v, { section: clean(body.section, 40) || "Main", kind: body.kind, places: num(body.places, 1, 60), place: body.place ?? null, view: body.view ?? null }); break;
      case "stage":   out = b.setStage(clean(body.camera, 80), body.where, user, v); break;
      case "plan":    out = b.setPlan(body.plan, user, v); break;
      case "undo":    out = b.undoLast(user); break;
      default:        out = { error: "Don't know how to do that" };
    }
    if (out?.ok) await this.saveBuilding(true);
    return out?.error ? { ...out, error: out.error } : { ...out, ...(await this.theBuilding()).overview() };
  }

  /**
   * The whole truth about what is working.
   *
   * A green light here means the checks behind it passed, not that nothing has
   * complained. Each camera is checked on four separate questions — is it
   * reporting, is it sending a picture, is that picture black or frozen, is it
   * counting — because one word covering four questions is how a broken camera
   * stays green.
   */
  async healthReport() {
    const now = Date.now();
    const cams = await this.get("cameras", {});
    const live = await this.get("live", {});
    const t = await this.troubles();
    const cameras = Object.values(cams)
      .filter((c) => !c.hidden && !c.pending)
      .map((c) => {
        const l = live[c.camera_id] || {};
        const needs = c.location === "entrance" ? MIN_FPS_FOR_DOOR : 0;
        const h = cameraHealth({
          updated_at: l.updated_at, fps: l.fps, counted_at: l.counted_at ?? l.updated_at,
          error: l.error_reason, no_picture: !!l.no_picture, black: !!l.black, frozen: !!l.frozen,
        }, now, needs);
        return {
          camera_id: c.camera_id, name: c.name, where: c.location || "indoor",
          ...h,
          last_seen: l.updated_at ? new Date(l.updated_at).toISOString() : null,
          fps: l.fps ?? 0, needs_fps: needs,
          picture_size: l.width && l.height ? `${l.width}x${l.height}` : null,
        };
      });
    const service = await this.get("service_live", null);
    const problems = t.list(now);
    const live_problems = problems.filter((x) => !x.fixed);
    return {
      // Green only when every check passed. Anything failing is named.
      ok: live_problems.length === 0 && cameras.every((c) => c.ok),
      checked_at: new Date(now).toISOString(),
      code: VENUE_CODE,
      cameras,
      cameras_working: cameras.filter((c) => c.ok).length,
      cameras_total: cameras.length,
      service: service ? { id: service.id, name: service.name, since: service.started_at } : null,
      counting: {
        register_running: !!this.register,
        people_in_register: this.register?.size ?? 0,
        building_seats: this.building ? this.building.overview().total : 0,
        // Said plainly: with no register, the attendance figure is each
        // camera's own tally, which counts the same people over and over.
        attendance_is_from_register: !!this.register?.size,
      },
      problems,
      problems_now: live_problems.length,
    };
  }

  async troubles() {
    if (!this.trouble) this.trouble = new Trouble(await this.get("trouble", null));
    return this.trouble;
  }

  /** Record a failure where it can be seen, and keep it. */
  async wrong(where, what, detail = "") {
    const t = await this.troubles();
    t.note(where, what, detail);
    await this.ctx.storage.put("trouble", t.save());
  }

  /** That part is working again. The record stays, marked fixed. */
  async working(where) {
    const t = await this.troubles();
    if (!t.items.size) return;
    // Saved whenever something actually changed. It used to save only when the
    // LAST live problem cleared, so with four problems showing, three of them
    // fixing themselves was never written down — and came back on the next
    // reload, which is exactly how a page of red that nobody can shift comes
    // about.
    if (t.ok(where)) await this.ctx.storage.put("trouble", t.save());
  }

  /** Somebody has looked at this problem. See Trouble.aside in health.js. */
  async putAside(where, what, who) {
    const t = await this.troubles();
    const n = t.aside(where, what, who);
    if (n) await this.ctx.storage.put("trouble", t.save());
    return n;
  }

  /** Every problem showing now, put aside in one go. Anything still going
   *  wrong is back within seconds, because the next failure marks it live. */
  async putAsideAll(who) {
    const t = await this.troubles();
    let n = 0;
    for (const v of t.items.values()) if (!v.fixed) n += t.aside(v.where, v.what, who);
    if (n) await this.ctx.storage.put("trouble", t.save());
    return n;
  }

  /** That part of Kyro is gone, so its record goes with it. */
  async forgetTrouble(...wheres) {
    const t = await this.troubles();
    let gone = 0;
    for (const w of wheres) if (w) gone += t.forget(w);
    if (gone) await this.ctx.storage.put("trouble", t.save());
    return gone;
  }

  /**
   * Keep the register's face codes for this service.
   *
   * Only people whose face reading has changed are written, so this is a few
   * rows every half minute rather than the whole congregation each time.
   */
  saveFaces(service, now) {
    if (!service || !this.register) return 0;
    this.facesSaved ??= new Map();
    let wrote = 0;
    for (const p of this.register.people.values()) {
      const face = p.faces[p.faces.length - 1];
      if (!face) continue;
      // Keyed by service AND person: person numbers start again at 1 in a new
      // service, so remembering "person 1 is already saved" by number alone
      // would skip a different person in the next one.
      if (this.facesSaved.get(`${service}#${p.id}`) === p.faces.length) continue;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO faces (service, person, code, at) VALUES (?, ?, ?, ?)",
        service, p.id, packFace(face), now);
      this.facesSaved.set(`${service}#${p.id}`, p.faces.length);
      wrote++;
    }
    return wrote;
  }

  /**
   * Give the register back the faces it had before the restart.
   *
   * This is the whole point of writing them down. Without it a restart leaves
   * the congregation to be recognised by their coats alone, and people who
   * were already counted are counted again — twenty five became twenty nine.
   */
  loadFaces(service, now) {
    if (!service || !this.register) return 0;
    const rows = this.ctx.storage.sql.exec(
      "SELECT person, code FROM faces WHERE service = ? AND at > ?", service, now - FACE_MAX_AGE_MS).toArray();
    let back = 0;
    this.facesSaved ??= new Map();
    for (const r of rows) {
      const p = this.register.people.get(r.person);
      const code = r.code ? unpackFace(r.code) : null;
      if (!p || !code) continue;
      p.faces = [code];
      this.facesSaved.set(`${service}#${p.id}`, 1);
      back++;
    }
    return back;
  }

  /**
   * Face data goes.
   *
   * With no service named, all of it — that is the end of a service, and face
   * matching being switched off. With one named, everything belonging to any
   * other service, and anything older than FACE_MAX_AGE_MS whatever service
   * it belongs to: a limit that holds even when a service never ended
   * properly, which is exactly the case this has to survive.
   */
  /**
   * Write down when each different person was first and last seen.
   *
   * The register itself lives in memory and dies with the service. These two
   * timestamps per person are what every figure afterwards is built from, so
   * they are kept: how many people were there (how many rows), when they
   * arrived (first_at) and when they left (last_at).
   *
   * Nothing here describes anybody. The person number means nothing outside
   * its own service and nothing is kept that could match a person in one
   * service to a person in another.
   */
  /**
   * People who have stopped existing, taken out of the table too.
   *
   * ── The thing this fixes ────────────────────────────────────────────────
   *
   * "if ever you make a mistake, make sure you put the number down!! dont
   * just pile up the false data with the real data ... if you finally
   * identified that it was 1 person and not 2 put the number down".
   *
   * Correcting the register in memory was only half a correction. Every
   * figure a church actually reads — attendance for the day, "busiest day",
   * "came in this session", the arrival chart — is built from rows in the
   * people table, written as people are seen. Merging two entries into one
   * left the second row exactly where it was, so the register said 1 and the
   * page went on saying 2. That is the pile-up: a number that could only
   * ever climb, because nothing was ever taken back out of it.
   *
   * Marked deleted rather than destroyed, like everything else here, so a
   * correction can itself be undone. Every figure filters them out, so they
   * come off the screen the moment this runs.
   */
  forgetPeopleRows(service) {
    const gone = this.register?.takeGone?.() ?? [];
    if (!service || !gone.length) return 0;
    const at = Date.now();
    let n = 0;
    try {
      for (const id of gone) {
        this.ctx.storage.sql.exec(
          "UPDATE people SET deleted_at = ? WHERE deleted_at IS NULL AND service = ? AND person = ?", at, service, id);
        // Their comings and goings go with them. A visit by somebody who
        // turned out to be a pillow, or to be somebody else all along, is
        // not a visit.
        this.ctx.storage.sql.exec("DELETE FROM visits WHERE service = ? AND person = ?", service, id);
        n++;
      }
      // Every figure below is built from those rows, so none of them may be
      // answered from a cache made before this.
      this.movementCache = null;
    } catch (e) {
      this.wrong("Register of people",
        "Corrected who was here, but couldn't take the old entries out of the day's figures — those will read too high until this clears",
        e && e.message).catch(() => {});
    }
    return n;
  }

  savePeople(service) {
    if (!service || !this.register) return;
    // Anyone who has stopped existing goes first, so a row is never written
    // back for somebody who was merged away a moment ago.
    this.forgetPeopleRows(service);
    try {
      // Only the people something has happened to since the last save. A full
      // congregation is nine hundred rows and this runs every half minute;
      // rewriting a row to the value it already holds is work for nothing.
      const since = this.peopleSavedFor === service ? this.peopleSavedAt : 0;
      for (const [id, p] of this.register.people) {
        if ((p.lastAt || 0) < since) continue;
        this.ctx.storage.sql.exec(
          "INSERT INTO people (service, person, first_at, last_at) VALUES (?, ?, ?, ?)"
          + " ON CONFLICT (service, person) DO UPDATE SET last_at = excluded.last_at",
          service, id, p.firstAt || 0, p.lastAt || 0,
        );
      }
      // Every visit, with its end left open while somebody is still here.
      // Written with the people, so the two can never disagree about who was
      // in the building.
      for (const [id, p] of this.register.people) {
        if ((p.lastAt || 0) < since) continue;
        for (const sp of p.spells ?? []) {
          this.ctx.storage.sql.exec(
            "INSERT INTO visits (service, person, in_at, out_at) VALUES (?, ?, ?, ?)"
            + " ON CONFLICT (service, person, in_at) DO UPDATE SET out_at = excluded.out_at",
            service, id, sp.in || 0, sp.out ?? null,
          );
        }
      }
      this.peopleSavedFor = service;
      this.peopleSavedAt = Date.now();
      this.movementCache = null;      // the figures below are built from these rows
      // A year is plenty, and keeps the table from growing without end.
      this.ctx.storage.sql.exec("DELETE FROM people WHERE first_at < ?", Date.now() - PEOPLE_KEPT_MS);
      this.ctx.storage.sql.exec("DELETE FROM visits WHERE in_at < ?", Date.now() - PEOPLE_KEPT_MS);
    } catch (e) {
      // Attendance quietly reverting to counting flicker is exactly the
      // failure this is here to end, so it is never swallowed.
      this.wrong("Register of people", "Couldn't write down who was seen — attendance will fall back to the cameras' own tallies", e && e.message).catch(() => {});
    }
  }

  /**
   * Arrivals and departures for the service running now, in quarter-hour
   * slots, counting each person ONCE.
   *
   * Every slot size the card offers (15, 30, 60, 120, 180, 240 minutes) is a
   * whole number of quarter hours, so the page can add these up into whatever
   * it is showing without ever going back to the cameras' own tallies.
   *
   * Read from the people table rather than the register in memory, so it
   * survives a restart mid-service — and because that is the same table every
   * figure after today is built from, which is how the live page and
   * Analytics stop disagreeing.
   */
  registerMovement(service, now = Date.now()) {
    if (!service) return null;
    // Every open page polls the live total every few seconds, and this reads a
    // row per person. Worked out once and held until the next save, which is
    // the only thing that can change the answer. See MOVEMENT_FRESH_MS.
    const cached = this.movementCache;
    if (cached && cached.service === service && now - cached.at < MOVEMENT_FRESH_MS) return cached.value;
    let rows;
    try {
      rows = this.ctx.storage.sql.exec(
        "SELECT first_at, last_at FROM people WHERE deleted_at IS NULL AND service = ? ORDER BY first_at", service).toArray();
    } catch { return null; }
    if (!rows.length) { this.movementCache = { service, at: now, value: null }; return null; }
    const SLOT = 15 * 60_000;
    const from = Math.floor(rows[0].first_at / SLOT) * SLOT;
    const slots = Math.max(1, Math.ceil((now - from) / SLOT));
    const arrived = new Array(slots).fill(0), left = new Array(slots).fill(0);
    let gone = 0;
    for (const r of rows) {
      const a = Math.min(slots - 1, Math.max(0, Math.floor((r.first_at - from) / SLOT)));
      arrived[a]++;
      // Still being seen is not having left. See LEFT_AFTER_MS.
      if (r.last_at && now - r.last_at > LEFT_AFTER_MS) {
        left[Math.min(slots - 1, Math.max(0, Math.floor((r.last_at - from) / SLOT)))]++;
        gone++;
      }
    }
    const value = { minutes: 15, from, arrived, left, total_arrived: rows.length, total_left: gone };
    this.movementCache = { service, at: now, value };
    return value;
  }

  /**
   * Different people, by the day they were seen, with when they arrived and
   * when they left — the register's answer rather than the cameras' tallies.
   *
   * @returns Map of date (in `tz`) → { people, arrived[24], left[24] }
   */
  peopleByDay(since, tz, now = Date.now()) {
    const out = new Map();
    let rows;
    try {
      rows = this.ctx.storage.sql.exec(
        "SELECT service, first_at, last_at FROM people WHERE deleted_at IS NULL AND first_at >= ? ORDER BY first_at", since).toArray();
    } catch { return out; }
    if (!rows.length) return out;
    const fmt = this.dateFmt(tz);
    let hourFmt;
    try { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }); }
    catch { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }); }
    const live = this.register?.service ?? null;
    for (const r of rows) {
      const d = fmt.format(new Date(r.first_at));
      let v = out.get(d);
      if (!v) { v = { people: 0, arrived: new Array(24).fill(0), left: new Array(24).fill(0) }; out.set(d, v); }
      v.people++;
      v.arrived[Number(hourFmt.format(new Date(r.first_at))) % 24]++;
      // Somebody still being seen has not left. For a service that finished,
      // everyone's last sighting is long past and everyone left — which is
      // what happens at the end of a service. For the one running now, only
      // the people nobody has seen for a while.
      const gone = r.service !== live || now - r.last_at > LEFT_AFTER_MS;
      if (gone && r.last_at) v.left[Number(hourFmt.format(new Date(r.last_at))) % 24]++;
    }
    return out;
  }

  wipeFaces(keepService = null, now = Date.now()) {
    try {
      if (keepService) {
        this.ctx.storage.sql.exec("DELETE FROM faces WHERE service != ? OR at <= ?", keepService, now - FACE_MAX_AGE_MS);
      } else {
        this.ctx.storage.sql.exec("DELETE FROM faces");
      }
      this.facesSaved = new Map();
    } catch (e) {
      // Failing to delete biometric data is not something to carry on quietly
      // past. It goes where it will be seen, like everything else.
      this.wrong("Face data", "Couldn't delete the face codes for a finished service", e && e.message).catch(() => {});
    }
  }

  /**
   * May faces be read at all, right now?
   *
   * The switch an administrator turns on, after confirming the DPIA and the
   * notices. Asked again on every report rather than trusted from earlier in
   * the request, so switching it off stops the processing immediately and
   * takes the face codes with it.
   */
  async facesAllowed() {
    return (await this.privacy()).face_matching === true;
  }

  async theBuilding() {
    if (!this.building) this.building = new Building(await this.get("building", {}));
    return this.building;
  }

  /** Written after a change, and never more often than is useful. */
  async saveBuilding(force = false) {
    if (!this.building) return;
    const now = Date.now();
    if (!force && now - this.buildingSavedAt < 10_000) return;
    this.buildingSavedAt = now;
    await this.ctx.storage.put("building", this.building.save());
  }

  /**
   * A camera's own seat list, turned into master seats.
   *
   * Each camera seat becomes, or finds, one master seat. Nothing is merged
   * here: at this point there is no evidence that two cameras are looking at
   * the same chair, and guessing is exactly how two neighbouring chairs become
   * one. Duplicates are settled later, by who sits in them.
   */
  async seatsIntoBuilding(camera_id, seats, now) {
    const b = await this.theBuilding();
    const before = b.version;
    for (const s of seats) {
      if (!s.seat_id || !Array.isArray(s.bbox)) continue;
      b.sawSeat(camera_id, s.seat_id, s.bbox, now, { section: s.section || "Main" });
    }
    if (b.version !== before) await this.saveBuilding();
  }

  /** An offline camera on another computer with the same (specific) name — the camera was moved. */
  movedFrom(cams, live, camera_id, device_id, label) {
    const norm = (x) => String(x || "").toLowerCase().replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/, "").replace(/\s+/g, " ").trim();
    const want = norm(label);
    // Names every computer has (or that say nothing about the camera) can't identify one.
    if (!want || /^(usb camera|camera|webcam|usb video device)( \d+)?$/.test(want)
      || /facetime|integrated|built-?in|iphone|ipad|desk view|virtual|obs/.test(want)) return null;
    // Only a camera that has been gone a good while, and the same sort of camera.
    // (Two computers starting together must not steal each other's cameras: the
    // loser would come back as a brand-new "pending" camera and count nothing.)
    const kind = cams[camera_id]?.kind;
    const gone = (id) => !this.isOnline(live[id]) && Date.now() - (live[id]?.updated_at ?? 0) > MOVED_AFTER_MS;
    const matches = Object.values(cams).filter((o) => o.camera_id !== camera_id && o.device_id !== device_id
      && o.kind !== "network" && o.kind === kind && norm(o.label ?? o.name) === want && gone(o.camera_id));
    // Most recently used first.
    matches.sort((a, b) => (live[b.camera_id]?.updated_at ?? 0) - (live[a.camera_id]?.updated_at ?? 0));
    return matches[0] ?? null;
  }

  /** Moves a camera's settings and history onto its new record, and removes the old one. */
  async takeOver(cams, live, old, camera_id) {
    const c = cams[camera_id];
    for (const k of ["name", "zone_name", "zone_capacity", "capacity_from", "zone_order", "location", "hidden", "created_at"]) c[k] = old[k];
    this.ctx.storage.sql.exec("UPDATE history SET camera_id = ? WHERE camera_id = ?", camera_id, old.camera_id);
    delete cams[old.camera_id];
    delete live[old.camera_id];
    await this.ctx.storage.delete(`snap:${old.camera_id}`);
  }

  async snapshot(device, request, url) {
    const key = clean(url.searchParams.get("camera"), 80);
    const buf = await request.arrayBuffer();
    if (!key || buf.byteLength === 0 || buf.byteLength > MAX_SNAPSHOT_BYTES) return json({ error: "Bad picture" }, 400);
    await this.ctx.storage.put(`snap:${device.id}:${key}`, { at: Date.now(), data: buf });
    return json({ ok: true });
  }

  /**
   * The latest picture from a camera — and nothing at all once that picture
   * has stopped being "latest".
   *
   * A camera switched off on Sunday afternoon went on showing Sunday
   * afternoon's picture. The tile said Offline in the corner, and underneath
   * it was a room full of people, in colour, looking exactly like now. A
   * picture is the most convincing thing on a screen; a label cannot argue
   * with it.
   *
   * So a picture from a camera that is no longer reporting is not served at
   * all. The page gets nothing and says the camera is off, which is the truth
   * and is impossible to misread.
   */
  async getSnapshot(camera_id) {
    const s = await this.ctx.storage.get(`snap:${camera_id}`);
    if (!s) return new Response("No picture yet", { status: 404 });
    const live = await this.get("live", {});
    const reporting = this.isOnline(live[camera_id]);
    const age = Date.now() - (s.at || 0);
    if (!reporting || age > SNAPSHOT_STALE_MS) {
      return new Response("That camera isn't on, so there is no picture of now", {
        status: 404,
        headers: { "Cache-Control": "no-store", "X-Last-Picture": new Date(s.at || 0).toISOString() },
      });
    }
    return new Response(s.data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Taken-At": new Date(s.at).toISOString() } });
  }

  // ── Live video ─────────────────────────────────────────────────────────────
  // The camera computer keeps a WebSocket open here. While someone is watching a
  // camera, it sends that camera's newest picture over and over (live video);
  // each picture goes straight on to everyone watching. Nobody watching → it
  // sends nothing, so no internet is used for video.

  boxStream(device, request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
    for (const old of this.ctx.getWebSockets(`box:${device.id}`)) { try { old.close(1000, "Replaced"); } catch {} }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["box", `box:${device.id}`]);
    server.serializeAttachment({ kind: "box", device: device.id });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.tellBox(device.id, null, server);
    // Echo the protocol back when one was offered, or a browser refuses the
    // connection. The installed camera computer offers none and is unaffected.
    const offered = request.headers.get("Sec-WebSocket-Protocol");
    return new Response(null, {
      status: 101, webSocket: client,
      ...(offered ? { headers: { "Sec-WebSocket-Protocol": "kyro" } } : {}),
    });
  }

  async watch(camera_id, request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
    const cams = await this.get("cameras", {});
    const cam = cams[camera_id];
    if (!cam) return json({ error: "No such camera" }, 404);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["watch", `watch:${camera_id}`]);
    server.serializeAttachment({ kind: "watch", camera_id, device: cam.device_id });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Show the last picture straight away while the video starts — but only
    // if it is a picture of NOW.
    //
    // This was the other half of the stale-picture problem, and the more
    // confusing half. The still endpoint had been taught to refuse an old
    // picture; this one went on pushing it down the live-video socket the
    // instant anybody connected, where the page stamps whatever arrives as
    // having been taken this second. So a camera that had been off since
    // Sunday showed a full hall labelled "Picture from 6s ago", and flickered
    // between that and "this camera is off" as the two paths fought: one
    // clearing the picture, the other pushing it straight back.
    const snap = await this.ctx.storage.get(`snap:${camera_id}`);
    const live = await this.get("live", {});
    const fresh = snap?.data && this.isOnline(live[camera_id]) && Date.now() - (snap.at || 0) <= SNAPSHOT_STALE_MS;
    if (fresh) { try { server.send(snap.data); } catch {} }
    this.tellBox(cam.device_id);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "kyro" } });
  }

  /** Tells a camera computer which of its cameras someone is watching. */
  tellBox(device_id, leaving = null, only = null) {
    const keys = new Set();
    for (const w of this.ctx.getWebSockets("watch")) {
      if (w === leaving) continue;
      const a = w.deserializeAttachment();
      if (a?.device === device_id) keys.add(a.camera_id.slice(device_id.length + 1));
    }
    const msg = JSON.stringify({ watch: [...keys] });
    for (const b of only ? [only] : this.ctx.getWebSockets(`box:${device_id}`)) { try { b.send(msg); } catch {} }
  }

  webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment();
    if (a?.kind !== "box" || typeof msg === "string") return;
    // [key length][key][JPEG]
    const bytes = new Uint8Array(msg);
    const n = bytes[0];
    const camera_id = `${a.device}:${new TextDecoder().decode(bytes.subarray(1, 1 + n))}`;
    const jpeg = msg.slice(1 + n);
    for (const w of this.ctx.getWebSockets(`watch:${camera_id}`)) { try { w.send(jpeg); } catch {} }
  }

  webSocketClose(ws, code) {
    const a = ws.deserializeAttachment();
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {}
    if (a?.kind === "watch") this.tellBox(a.device, ws);
  }

  webSocketError(ws) { this.webSocketClose(ws, 1011); }

  // ── What the website reads ────────────────────────────────────────────────

  async cameraList(includeHidden = false) {
    const cams = await this.get("cameras", {});
    const live = await this.get("live", {});
    const devices = await this.get("devices", {});
    return Object.values(cams)
      .filter((c) => (includeHidden || (!c.hidden && !c.pending)) && devices[c.device_id])
      .sort((a, b) => a.zone_order - b.zone_order)
      .map((c) => ({
        camera_id: c.camera_id, name: c.name, stream_url: c.kind === "usb" ? (/^usb-\d+$/.test(c.key) ? `USB camera ${Number(c.key.slice(4)) + 1}` : "USB camera")
          : c.kind === "web" ? `Camera mode · ${devices[c.device_id]?.name ?? "browser"}` : c.address || "Network camera",
        location: c.location, zone_name: c.zone_name, zone_capacity: c.zone_capacity, zone_order: c.zone_order,
        /**
         * Whether somebody ENTERED that seat count or Kyro guessed it.
         *
         * Left out of this list, and this list is what venueTotal() reads.
         * So every seat count in the building came back as a guess, however
         * carefully it had been typed in — and a guess is deliberately not
         * allowed to drive anything. "Seats —  set it on Cameras" on a card
         * beside a camera already showing a capacity of 91, every time,
         * whatever she set. The same blank for "how full" and "spaces left",
         * and the filling-up alerts silent with it.
         */
        capacity_from: c.capacity_from ?? null,
        is_active: !c.hidden && this.isOnline(live[c.camera_id]), created_at: c.created_at, kind: c.kind, device_id: c.device_id,
        hidden: !!c.hidden, pending: !!c.pending, ignore_zones: c.ignore_zones ?? [], device_name: devices[c.device_id]?.name ?? "",
        inward: c.inward || "closer",
        // Plugged in right now (its computer mentioned it in the last 30 s)?
        present: Date.now() - (this.seenAt.get(c.camera_id) ?? 0) < 30_000, fps: live[c.camera_id]?.fps ?? 0,
        // Only a camera that is actually reporting has anything to say about
        // itself. Keeping the last words of a camera that has since gone quiet
        // leaves old text — "Starting…" — sitting beside a camera that stopped
        // reporting minutes ago. venueTotal() already drops it; this didn't.
        error_reason: this.isOnline(live[c.camera_id]) ? live[c.camera_id]?.error_reason ?? null : null,
      }));
  }

  isOnline(l) { return !!l && Date.now() - l.updated_at < OFFLINE_AFTER_MS && l.status !== "offline"; }

  /** Is any camera, on any computer, still counting? */
  anyCameraOn(cams, live, now = Date.now()) {
    for (const c of Object.values(cams)) {
      if (c.hidden || c.pending) continue;
      const l = live[c.camera_id];
      if (l && now - l.updated_at < OFFLINE_AFTER_MS && l.status !== "offline") return true;
    }
    return false;
  }

  /**
   * Every decision the door cameras made recently, newest first, with the
   * camera's name — and a tally of what it adds up to, including how many
   * repeats were turned away. "I don't know what you're counting" deserves an
   * answer that can be held up against the door itself.
   */
  /**
   * Every coming and going this service, and how many are still inside.
   *
   * Read from the register in memory when there is one, and from the table
   * otherwise — so a page opened after a restart, or on a phone that was
   * never doing the counting, shows the same thing.
   *
   * A person is a NUMBER. Kyro does not know who anybody is, and this is the
   * one screen somebody might expect it to, so the page says so.
   */
  async visitLog() {
    const service = (await this.get("service_live", null));
    if (!service) return { service: null, inside: 0, visits: [], people: 0 };
    let rows;
    try {
      rows = this.ctx.storage.sql.exec(
        "SELECT v.person, v.in_at, v.out_at FROM visits v"
        + " JOIN people p ON p.service = v.service AND p.person = v.person AND p.deleted_at IS NULL"
        + " WHERE v.service = ? ORDER BY v.in_at DESC LIMIT 300",
        service.id).toArray();
    } catch (e) {
      await this.wrong("Comings and goings", "Couldn't read who came in and out", e && e.message);
      return { service: service.id, inside: 0, visits: [], people: 0, error: true };
    }
    return {
      service: service.id,
      service_name: service.name,
      /** Visits with no end yet — the people the register has not recorded leaving. */
      inside: this.register?.inBuilding?.() ?? rows.filter((r) => r.out_at === null).length,
      people: this.register?.size ?? new Set(rows.map((r) => r.person)).size,
      visits: rows.map((r) => ({
        person: r.person,
        in: new Date(r.in_at).toISOString(),
        out: r.out_at ? new Date(r.out_at).toISOString() : null,
      })),
    };
  }

  async doorLogFor() {
    const cams = await this.get("cameras", {});
    const events = [];
    for (const [camera_id, log] of this.doorLog) {
      const name = cams[camera_id]?.name || camera_id;
      for (const e of log) events.push({ camera: name, camera_id, at: new Date(e.at).toISOString(), kind: e.kind });
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const count = (k) => events.filter((e) => e.kind === k).length;
    return {
      events: events.slice(0, 200),
      counted_in: count("in"), counted_out: count("out"),
      // Somebody Kyro recognised who was already counted that way in this
      // service: the usher holding the door, counted once.
      repeats_not_counted: count("again-in") + count("again-out"),
      // At the door, and went back the way they came.
      unclear: count("unclear"),
    };
  }

  async venueTotal() {
    const cams = (await this.cameraList()).filter((c) => c.location !== "queue");
    const live = await this.get("live", {});
    // Where this session's figures start from — see freshStart().
    const freshAt = await this.get("count_from", 0);
    const base = await this.get("count_base", {});
    const zones = cams.map((c) => {
      const l = live[c.camera_id] || {};
      const running = this.isOnline(l);
      // Reporting is not counting. A camera Kyro can see but cannot open now
      // reports with its reason — which is the thing the operator needed —
      // but it must not then be added to "cameras running", or a camera that
      // has never opened makes the system look healthier than it is.
      const counting = running && !(l.status === "error" && l.no_picture);
      const current = running ? l.current || 0 : 0;
      return {
        camera_id: c.camera_id, zone_name: c.zone_name || c.name, camera_name: c.name, location: c.location || "indoor",
        current, peak: l.peak || 0,
        entries: sinceFresh(l.entries, base[c.camera_id] && base[c.camera_id].entries),
        exits: sinceFresh(l.exits, base[c.camera_id] && base[c.camera_id].exits),
        // Everything this camera has counted, whatever was asked of the
        // session figures. Used for "how many are in the building".
        entries_all: l.entries || 0, exits_all: l.exits || 0,
        /** Different people this camera has seen this service, counted once each. */
        people: l.people || 0,
        capacity: c.zone_capacity || 0,
        /**
         * Where that number came from: "admin" if somebody entered it,
         * "found" if the seat finder guessed it from the picture. A guess is
         * shown as a guess and drives nothing — see syncCapacity.
         */
        capacity_from: c.capacity_from === "admin" ? "admin" : c.zone_capacity ? "found" : null,
        occupancy_pct: c.capacity_from === "admin" && c.zone_capacity ? Math.round((current / c.zone_capacity) * 1000) / 10 : 0,
        is_running: running, status: running ? l.status || "online" : "offline", error_reason: running ? l.error_reason ?? null : null,
        // Online AND actually producing a picture. is_running stays true so
        // the reason above is still shown; this is what "running" counts.
        is_counting: counting,
        // In/out means following people between pictures, which needs the camera
        // to be counting fast enough — otherwise someone merely flickering out of
        // view looks like a departure. A doorway camera needs to be quicker
        // still: people cross a door in a second or two, and one missed between
        // two counts is a person uncounted.
        in_out: (l.fps || 0) >= (c.location === "entrance" ? MIN_FPS_FOR_DOOR : MIN_FPS_FOR_IN_OUT),
        // How many counts a second this camera is managing, and how many it
        // needs, so the page can say why a figure is missing instead of
        // quietly leaving it out.
        fps: running ? Math.round((l.fps || 0) * 10) / 10 : 0,
        fps_needed: c.location === "entrance" ? MIN_FPS_FOR_DOOR : MIN_FPS_FOR_IN_OUT,
      };
    });
    // A camera on the door and a camera on the room are doing two different
    // jobs. The door one says who came and went; the room one says how many
    // are there now. Adding the door's people to the room's is counting the
    // same person twice — once on the way in, once sitting down.
    const doorZones = zones.filter((z) => z.location === "entrance");
    const roomZones = zones.filter((z) => z.location !== "entrance");
    // Cameras watching the same room are one room, not two — see roomTotals.
    const rooms = roomTotals(roomZones);
    const doors = roomTotals(doorZones);
    const sum = (k) => rooms.reduce((n, r) => n + (r[k] || 0), 0);
    const sumDoors = (k) => doors.reduce((n, r) => n + (r[k] || 0), 0);
    // Only capacities somebody actually entered are added up. A guessed one
    // would make "space left" and "how full" for the whole building rest on
    // what a camera thought it could see — see syncCapacity.
    /**
     * Attendance: the doorway's answer when there is one, the rooms' when
     * there isn't.
     *
     * ── Why the doorway has to be allowed to answer this ──────────────────
     *
     * "because the room camera cannot see the whole room, the door camera
     * basically needs to do the counting too to be honest."
     *
     * She is right, and this had it backwards. Attendance came from the
     * register — which is fed by the ROOM cameras, because a doorway is not
     * allowed to put anybody in it. In a wide hall a camera sees its own
     * corner, so the register was answering "how many different people have
     * been in that corner", under the name "attendance", for a building
     * where most of the congregation is never in shot.
     *
     * A doorway is the one camera that every person in the building passes,
     * one or two at a time, close and face-on. It keeps its own count of
     * DIFFERENT people — it remembers the ones it has already counted, so
     * the usher holding the door is counted once, and somebody stepping out
     * for a phone call is not a second person. That is an attendance
     * figure, measured where attendance can actually be measured.
     *
     * So: the doorway answers when a doorway is counting. The rooms' figure
     * is kept beside it under its own name, never added to it — everybody
     * the door sees also walks into a room, and adding them would count the
     * congregation twice.
     *
     * Two doorways take the fullest view rather than the sum, the same rule
     * two cameras on one room already follow: a church with a front and a
     * side door has one congregation, not two.
     */
    const doorPeople = doors.reduce((n, r) => Math.max(n, r.people || 0), 0);
    const roomPeople = this.register?.size ?? sum("people");
    const attendance = doorPeople > 0 ? doorPeople : roomPeople;
    const attendanceFrom = doorPeople > 0 ? "door" : this.register ? "rooms" : "cameras";
    const entered = rooms.reduce((n, r) => n + (r.capacity_from === "admin" ? r.capacity || 0 : 0), 0);
    /**
     * Seats are only ever a number somebody entered.
     *
     * A fixed count for one church used to stand in when nothing had been
     * entered — "remove the idea of there being 114 seats now, like remove
     * it completely". With it gone, no number means no seat count: "Seats
     * —", no hold at the seats, no "spaces left", and nothing claiming to
     * know how full a room is. That is the honest answer to a question
     * nobody has answered, and the control to answer it sits beside the
     * figure it corrects.
     */
    const cap = entered;
    /**
     * The seats in the building, for checking the attendance figure against.
     *
     * ── Why this is not `cap` ───────────────────────────────────────────────
     *
     * "both cameras are set as entrance and exit."
     *
     * Seats were stored against a ROOM camera, and a building whose cameras
     * are all on doorways has no room. So there was nowhere to put a seat
     * count: the field never appeared on the Cameras page, the number
     * entered on her behalf had nothing to attach to, and every version of
     * the hold built tonight was checking an attendance of 280 against a
     * capacity of zero and letting it through. Six rounds of "114 is still
     * not there", and the number had nowhere to live.
     *
     * The seats are a fact about the HALL. It has 114 chairs in it whether a
     * camera is pointed at them or not. So the check falls back to what the
     * church has stated about its own building.
     *
     * Kept apart from `cap` on purpose, and used ONLY here. `cap` drives
     * "spaces left", "how full" and the filling-up alerts, and those must go
     * on meaning "a camera is watching a room and somebody said how many
     * chairs are in it" — a building with no room camera genuinely cannot
     * say how full it is and must not pretend to. This answers a different
     * question: is the number of DIFFERENT PEOPLE recorded even possible in
     * this building?
     */
    const seatsHere = cap > 0 ? cap : await this.seatsInBuilding();
    // Face matching (if switched on): someone seen clearly by two cameras at once is counted once.
    const running = roomZones.filter((z) => z.is_running);
    const serviceNow = await this.get("service_live", null);
    const plan = await this.whatsOn();
    const faceOn = (await this.privacy()).face_matching && !!serviceNow;
    const runningIds = new Set(running.map((z) => z.camera_id));
    // How many of the cameras' sightings right now are the same person seen
    // twice. The register answers this whether or not face matching is on —
    // it uses whatever evidence it has, and a face is the strongest of
    // several. Face codes alone are kept as a floor, because a clear face
    // match is proof and the register is allowed to be cautious.
    const overlap = this.register ? this.register.seenNow(runningIds).duplicates : 0;
    let twice = Math.max(overlap, faceOn ? this.sameFaces(runningIds) : 0);
    // Overlap inside one room is already gone; only people seen in two
    // different rooms at once are left to take out, and never more than the
    // smaller rooms hold.
    const counts = rooms.map((r) => r.current || 0).sort((a, b) => b - a);
    twice = Math.min(twice, counts.slice(1).reduce((a, b) => a + b, 0));
    // A door camera watches a doorway, so its arrivals and departures are the
    // real ones. Only when there is no door camera do we fall back to what the
    // room cameras think, which is far shakier — someone stepping out of shot
    // looks like a departure.
    const hasDoor = doorZones.length > 0;
    // Arrivals and departures mean people crossing a line, and only a camera
    // on a doorway watches one.
    //
    // There used to be a fallback: with no door camera, the ROOM cameras'
    // figures were used instead. They are not arrivals. A room camera's "in"
    // is every person it became sure of and its "out" is every person it lost
    // sight of, so one person at a desk made six in and five out without
    // walking anywhere — and one tile read four out against two in, more
    // people leaving than had ever arrived, which cannot happen anywhere.
    //
    // There is a real answer now and it is not a crossing count: the register
    // knows how many different people have been seen and when each was last
    // seen (worker/identity.js). So room cameras are no longer asked a
    // question they cannot answer, and nothing stands in for the door.
    const trustInOut = hasDoor && doorZones.some((z) => z.is_running && z.in_out);
    const entries = sumDoors("entries");
    const exits = sumDoors("exits");
    // Switched on is not the same as working. The face AI is a 10 MB download
    // that runs in whichever browser is counting, and if it fails to load that
    // browser carries on counting without it — quietly, which is right for the
    // count and wrong for the person who switched face matching on and is
    // looking at a card that says "On". So: how many cameras have actually
    // sent a face reading recently, and how many faces were in them.
    const faceNow = Date.now();
    const faceFresh = [...this.faceCodes.entries()].filter(([, f]) => faceNow - f.at < FACE_FRESH_MS);
    const faceTrouble = await this.get("face_error", null);
    // Loaded and looking, as of the last report from the counting browser.
    const faceReadyAt = await this.get("face_ready_at", 0);
    // ── One number for "how many people are here" ──────────────────────────
    //
    // There were three, and all three were on the screen at once: the cameras
    // could see 9, the Sessions page said 13, and the headline said 1. Each
    // was answering a different question honestly and the church was left to
    // guess which one to believe.
    //
    // There is one rule now, used everywhere.
    //
    // What the cameras can see is a FLOOR: those people are demonstrably in
    // the building. No camera sees a whole hall, so it is almost always too
    // low. What the entrance has counted in, less what it has counted out, is
    // better when the door camera is keeping up — and nonsense when it isn't,
    // which is how the headline came to read 1 with nine people in shot.
    //
    // So: whichever is larger. It can never contradict what is plainly visible,
    // and it takes the door's word when the door has seen more than the room.
    // The page shows both parts underneath, so the number is never a mystery.
    const seenNow = Math.max(0, sum("current") - twice);
    // Everyone counted in, less everyone counted out — from the door when a
    // door camera is keeping up, and otherwise from the room cameras, which is
    // where the arrival figures on the page come from. The headline and the
    // "came in / went out" card are then the same arithmetic on the same
    // readings, instead of two answers side by side.
    const doorNet = trustInOut
      ? Math.max(0, sumDoors("entries_all") - sumDoors("exits_all"))
      : null;
    // No doorway: the register's own answer — everybody it knows who has been
    // seen in the last few minutes. People, not crossings. See hereNow() in
    // worker/identity.js, and LEFT_AFTER_MS for what "still here" means.
    const registerNow = this.register
      ? this.register.hereNow(Date.now(), LEFT_AFTER_MS, new Set(zones.filter((z) => z.is_running).map((z) => z.camera_id)))
      : 0;
    const countedNet = doorNet ?? registerNow;
    // A ceiling nobody can argue with: there cannot be more people in the
    // building than there are DIFFERENT people seen all service.
    //
    // "Counted in, less counted out" from ROOM cameras has no doorway to
    // watch, so one person stepping out of shot and back is an arrival every
    // single time. One person in front of one camera read 4, then 5, while
    // the same page said the cameras could see 1. The register
    // (worker/identity.js) is the only thing here that knows those were all
    // the same person, so it is the thing that caps it.
    //
    // The floor is still what the cameras can plainly see: if the register
    // has somehow merged two people into one, the headline follows the room,
    // not the register. A ceiling may lower a guess; it may never deny
    // somebody standing in shot.
    const everSeen = this.register?.size || 0;
    const ceiling = everSeen ? Math.max(everSeen, seenNow) : Infinity;
    // Nothing is counting, so nobody is being seen.
    //
    // With every camera off, "in venue" was still showing 1 — it came from
    // "counted in less counted out", a sum that goes on being true about
    // earlier long after it has stopped being true about now. The page said
    // CAMERAS 0/2 live directly beside it. A figure that outlives the thing
    // measuring it is worse than no figure: Kyro cannot see anybody, so the
    // honest answer is none.
    const anyRunning = zones.some((z) => z.is_running);
    const hereNow = anyRunning ? Math.min(Math.max(seenNow, countedNet), ceiling) : 0;
    /**
     * Is the counting bar in the right place? Worked out here, where the
     * door's figure and the rooms' are both already in hand, and acted on
     * rather than offered. See maybeSetSensitivity.
     */
    try {
      await this.maybeSetSensitivity(await this.suggestSensitivity(zones, doorPeople));
    } catch (e) {
      await this.wrong("Counting",
        "Couldn't check whether the counting sensitivity is in the right place",
        e && e.message);
    }
    return {
      seen_on_two_cameras: twice,
      // Cameras whose last report carried face readings, and how many faces
      // those readings held.
      face_cameras: faceFresh.length,
      face_people: faceFresh.reduce((n, [, f]) => n + f.codes.length, 0),
      // The face AI is loaded and looking at every count. Separate from
      // whether it found anyone: an empty hall, or a room of people facing the
      // front, reads no faces and nothing is wrong.
      face_engine_ready: !!faceReadyAt && faceNow - faceReadyAt < 30_000,
      // What went wrong in the browser doing the counting, if the face AI
      // couldn't be loaded there.
      face_error: faceTrouble && faceNow - faceTrouble.at < 5 * 60_000 ? faceTrouble.message : null,
      in_out_available: trustInOut,
      // The one figure. Every page reads this.
      total_current: hereNow,
      /**
       * How many different people have been seen this service, counted once
       * each — the attendance figure. Rooms are added together (a balcony is
       * not the main floor); two cameras on one room take the fullest view.
       * A doorway camera's own register is offered separately rather than
       * added, since everyone it sees also walks into a room.
       */
      /**
       * Attendance: how many different people have been seen this service, one
       * entry each, from the register every camera feeds (worker/identity.js).
       * Not a counter — the size of the register itself, so it cannot drift
       * away from the people it is made of.
       */
      people_seen: attendance,
      /**
       * Where that figure came from, and what the other answer was.
       *
       * Never just the number. These two disagreeing is the single most
       * useful thing Kyro can show about its own counting, and burying it
       * was how an impossible figure went unchallenged for a whole evening.
       */
      attendance_from: attendanceFrom,
      people_seen_in_rooms: this.register?.size ?? sum("people"),
      /** Whether that came from the register or from the cameras' own tallies. */
      people_from_register: !!this.register?.size,
      /**
       * Arrivals and departures that count each person ONCE, in quarter-hour
       * slots — the register's answer, not the cameras' tallies.
       *
       * The tallies count crossings: a room camera's "entries" is every
       * person it becomes sure of, so one person at a desk produced eleven
       * arrivals and eight departures. These are people.
       */
      movement: this.registerMovement(serviceNow?.id ?? null),
      /**
       * What the church's own rota says is happening, now and next.
       *
       * Published with the figures rather than fetched separately, because
       * the question "is Kyro aware of my rota?" is answered by the figures
       * and the rota agreeing on one screen — not by a second page that has
       * to be opened to find out. See whatsOn().
       */
      whats_on: plan,
      /** The service being recorded right now, so a page can show the rota
       *  and the recording side by side and the two can be seen to agree. */
      service_now: serviceNow
        ? { id: serviceNow.id, name: serviceNow.name, started_at: serviceNow.started_at, from_rota: !!serviceNow.from_rota }
        : null,
      /** Each camera's own tally, kept for comparison. Never added together. */
      people_seen_by_camera: sum("people"),
      people_seen_at_door: sumDoors("people"),
      /** What the cameras can actually see right now — the floor. */
      seen_now: seenNow,
      /** Everyone counted in less everyone counted out, from whichever
       *  cameras are being believed. The same sum the arrival card shows. */
      counted_net: countedNet,
      /** True when that sum came from a camera on a doorway rather than the room. */
      counted_net_from_door: doorNet !== null,
      /** Where "how many are here" came from when the door didn't answer. */
      counted_net_from_register: doorNet === null && registerNow > 0,
      /**
       * More people than the room holds.
       *
       * "a reminder, 114 people can fit in this room, so if there is more,
       * than something is wrong."
       *
       * She is right, and it is the only sanity check on a count that comes
       * from a fact about the building rather than from the thing being
       * checked. A hall with 114 seats does not hold 300 people, so a count
       * above its capacity is a count that has gone wrong — a wall counted
       * as two people, a photograph on a screen, somebody counted on both
       * cameras.
       *
       * Reported rather than silently capped. People do stand at the back,
       * so "more than the seats" is not impossible, only wrong often enough
       * to be worth saying out loud — and a figure quietly clamped to 114 is
       * a figure that cannot be investigated. It is only ever raised against
       * a capacity somebody ENTERED: against a seat count Kyro guessed from
       * the picture it would be one guess accusing another.
       */
      over_capacity: cap > 0 && hereNow > cap ? { seats: cap, counted: hereNow } : null,
      /**
       * More DIFFERENT people counted this service than the room has seats.
       *
       * "count is wrong, make sure this is more verified, i said max in the
       * room is 114 ... now theres 117, i said max is 114 so i dnt know how
       * it got to 118."
       *
       * Different from over_capacity above, which is about this moment: a
       * hall of 114 seats holding 130 people. This is about the service as a
       * whole, and it is the check that catches the failure she actually
       * hit. Attendance counts each person once and only climbs, so it CAN
       * honestly pass the seat count — a morning where fifty people leave
       * and fifty more arrive is 100 in a hall of 60, and nothing is wrong.
       * What makes it wrong is passing the seat count when hardly anybody
       * has left: there was never anywhere for the extra people to sit.
       *
       * So the figures that decide it are sent with it — the seats, the
       * count, and how many the register has actually recorded leaving — and
       * the page says the sum out loud rather than printing a number that
       * the room contradicts. Reported, never capped: a count quietly held
       * at 114 is a count nobody can investigate, and this is Kyro saying it
       * got something wrong, which it must be able to do.
       *
       * Raised against a seat count somebody ENTERED, or against the seat
       * count the church has stated for this building when no camera is
       * watching a room to hang one on — never against a count Kyro guessed
       * from a picture, which would be one guess accusing another. See
       * capacity_from and seatsHere.
       */
      attendance_over_seats: seatsHere > 0 && attendance > seatsHere
        ? {
            seats: seatsHere,
            counted: attendance,
            /**
             * Recorded as having left.
             *
             * Taken from the SAME figure that is being held, not from the
             * register when the doorway answered — two numbers from two
             * different counts cannot be subtracted from each other, and
             * doing it is how the card came to say 114 in and 273 out.
             */
            left: attendanceFrom === "door"
              // Everyone the door counted in, less everyone still inside it.
              ? Math.max(0, attendance - Math.max(0, doorNet ?? 0))
              : Math.max(0, attendance - (this.register?.inBuilding?.() ?? 0)),
          }
        : null,
      /**
       * The attendance figure to PUT ON THE SCREEN, held at the number of
       * seats when the measured one has passed it.
       *
       * ── Her decision, and why it is hers to make ────────────────────────
       *
       * "change this to 114, because i dont know how you got this number, i
       * dont think you listen, i said the max is 114 in this room, so it
       * must be inaccurate for you to put this number."
       *
       * She is right about the number and right about whose call it is. 159
       * different people in a room with 114 chairs is not a reading she has
       * to accept because Kyro measured it; it is Kyro being wrong in public
       * on the screen her church reads. The seat count is a fact about the
       * building, entered by the person who knows it. The 159 is a
       * measurement by something that has just been shown to double-count.
       * When they disagree, the building wins.
       *
       * What is held is the DISPLAY and nothing else. people_seen above is
       * the measurement, untouched; attendance_over_seats carries the sum so
       * the gap can be seen; the register, the people table and the
       * downloads all keep every entry exactly as it was recorded. Nothing
       * is deleted and nothing is rewritten — "Do not delete or rewrite
       * historical records to make the dashboard appear correct" — and the
       * card says in so many words that the figure is being held and what
       * was measured.
       *
       * The honest caveat, stated here because it belongs with the code: a
       * room CAN see more different people in a morning than it has chairs,
       * if enough of them leave and others take their places. In this hall,
       * on her say-so, it does not. Only ever against a seat count somebody
       * entered — never one Kyro guessed.
       */
      people_seen_shown: seatsHere > 0 && attendance > seatsHere ? seatsHere : attendance,
      /**
       * How many people the register has not yet recorded leaving.
       *
       * Different from "seen in the last few seconds" on purpose: this is
       * the written record — every visit has an end, and these are the ones
       * that do not have one yet. It is what answers "is the building
       * clear", which a live count cannot.
       */
      in_building_now: this.register?.inBuilding?.() ?? 0,
      /** The arrivals sum came out higher than the number of different people
       *  seen all service, so the register held the headline down. The page
       *  says so rather than quietly showing a smaller number than the sum
       *  printed next to it. */
      counted_net_capped: countedNet > hereNow ? everSeen : null,
      total_peak: sum("peak"),
      total_entries: trustInOut ? entries : null, total_exits: trustInOut ? exits : null,
      // How many people are in the building, counted at the door: everyone who
      // has come in today, less everyone who has gone out.
      //
      // Not the same question as "how many can the cameras see". A camera on a
      // doorway sees eleven people, then six, then twenty, as they walk
      // through — which is no use at all as an attendance figure, and is what
      // the headline was showing. These are people arriving; they should add
      // up to the number in the room. A camera on the room can only report
      // what is in its own view, which on a wide auditorium is a fraction of
      // the hall.
      //
      // It drifts: anyone the door camera misses is missed for the rest of the
      // day, both ways. So it is only offered when a camera is actually on the
      // door and counting fast enough to follow people through it, and the
      // page says plainly where the figure came from.
      in_building: doorNet,
      // The two running totals it is made of, so the page can show its
      // working. Deliberately NOT total_entries / total_exits: those answer
      // "this session", which after a fresh start is a different question and
      // would not add up to the figure above.
      came_in_all: hasDoor ? sumDoors("entries_all") : null,
      went_out_all: hasDoor ? sumDoors("exits_all") : null,
      // Whether a camera is actually watching the door, so the page can say
      // where the arrivals and departures came from.
      in_out_from_door: hasDoor,
      // Whether faces are being matched right now. Without it, someone who
      // steps out of the entrance camera's view and comes back can be counted
      // as arriving twice, and the page should not pretend otherwise.
      face_matching: faceOn,
      total_capacity: cap, venue_occupancy_pct: cap ? Math.round((hereNow / cap) * 1000) / 10 : 0,
      /**
       * Kyro's own reading of whether the Counting sensitivity is in the
       * right place — see suggestSensitivity. null when it has nothing to
       * say, which is most of the time.
       */
      /**
       * The last time Kyro moved the Counting sensitivity by itself, with
       * what it moved it from and why — shown on the service card for a few
       * hours, with one press to put it back. See maybeSetSensitivity.
       */
      sensitivity_set: await (async () => {
        const n = await this.get("sensitivity_set", null);
        return n && Date.now() - n.at < AUTO_SET_SHOW_MS ? n : null;
      })(),
      /**
       * Why these figures can be nought while a camera plainly sees people.
       *
       * "this is meant to be the session structure, so i dont know why its
       * like this" — beside a camera card reading 78 and a capacity of 91.
       *
       * Both are right, and that is the problem. "Here now" is built from
       * ROOM cameras, because a doorway is not a room: it sees everybody
       * once on their way through and nobody after that. "Seats" is built
       * from capacities somebody ENTERED on a room, because a guess must
       * not drive how full the building is said to be. So a building whose
       * only camera is set as a doorway, or whose seat count is Kyro's own
       * guess, gets nought under both — honestly, and with no way to tell
       * from the card which of the two it was.
       *
       * These three say which, so the card can say it in words rather than
       * leaving a nought to be argued with.
       */
      why_nothing: {
        /** Everything the running cameras can see between them, room or not. */
        cameras_seeing: zones.reduce((n, z) => n + (z.is_running ? z.current || 0 : 0), 0),
        /** No camera is watching a room, so there is nothing to be "here now" in. */
        no_room_camera: roomZones.length === 0 && doorZones.length > 0,
        /** A seat count that exists but is not allowed to drive anything, and
         *  why: on a doorway, or Kyro's own guess rather than an entered one. */
        seats_not_used: cap > 0 ? null
          : zones.filter((z) => z.capacity > 0).map((z) => ({
              camera: z.zone_name || z.camera_name, seats: z.capacity,
              because: z.location === "entrance" ? "doorway" : z.capacity_from === "admin" ? null : "guess",
            })).filter((x) => x.because)[0] ?? null,
      },
      /**
       * How many seats Kyro has FOUND by itself, when nobody has entered one.
       *
       * ── Why it is offered rather than used ───────────────────────────────
       *
       * "its not possible, its AI, Kyro should be able to detect it i dont
       * understand."
       *
       * She is right that it can. The seat finder counts chairs out of the
       * same AI run that finds people, and has been doing so all along.
       * What it must not do is quietly become the number everything is
       * checked against — that is the fault she caught a day earlier, when a
       * guess of 21 and 16 seats appeared from a camera that had seen
       * nothing: "the system should not even guess ... dont assume
       * anything".
       *
       * Both are right, and the way to keep both is to OFFER it. Kyro does
       * the counting, says what it found, and one press makes it the
       * answer — at which point it is a number somebody entered, which is
       * what every check here has always required.
       *
       * The fullest view of a room, never the sum, like every other room
       * figure.
       */
      seats_found: cap > 0 ? 0 : rooms.reduce((n, r) => n + (r.capacity_from === "found" ? r.capacity || 0 : 0), 0),
      zones, cameras_running: zones.filter((z) => z.is_counting).length, cameras_total: zones.length,
      // How many rooms those cameras add up to, so the page can say when two
      // of them are watching the same one.
      rooms_total: rooms.length, doors_total: doors.length,
      // When the arrivals and departures above started counting from, if a
      // fresh start was asked for. null means "everything the cameras have
      // counted". The page says which, so a figure is never silently partial.
      count_from: freshAt ? new Date(freshAt).toISOString() : null,
      // What the doorway cameras have been told, if anything. See door_mode.
      door_mode: (await this.get("door_mode", null))?.mode ?? "auto",
      door_mode_by: (await this.get("door_mode", null))?.by ?? "",
    };
  }

  async history(url) {
    // ?date=YYYY-MM-DD&tz=Europe/London[&camera=id] → per-minute points
    const date = url.searchParams.get("date") || "";
    const tz = url.searchParams.get("tz") || "UTC";
    const camera = url.searchParams.get("camera");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };
    // Which cameras are on a doorway. Only they can answer "in" and "out".
    const cams = await this.get("cameras", {});
    // Window: the calendar day in the church's timezone (±14h covers any offset).
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000;
    const end = Date.parse(`${date}T00:00:00Z`) + 38 * 3600_000;
    const rows = camera
      ? this.ctx.storage.sql.exec("SELECT * FROM history WHERE deleted_at IS NULL AND camera_id = ? AND ts >= ? AND ts < ? ORDER BY ts", camera, start, end).toArray()
      : this.ctx.storage.sql.exec("SELECT * FROM history WHERE deleted_at IS NULL AND ts >= ? AND ts < ? ORDER BY ts", start, end).toArray();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return rows
      .filter((r) => fmt.format(new Date(r.ts)) === date)
      .map((r) => {
        /**
         * In and out are believed from a doorway, and from nowhere else.
         *
         * This was the other half of "1 person on the camera and 6 came in".
         * venueTotal had already been taught that a room camera's "entries"
         * is not arrivals — it is every person it became sure of, so every
         * track that dies and restarts adds one — but THIS endpoint had not,
         * and this endpoint is what the arrivals chart and the "came in,
         * this session" tile are built from whenever the register's own
         * figures aren't available. So the number Kyro refused to show in
         * one place it showed in another, from the same readings.
         *
         * The date cutoff stays as well: before it, even doorway figures
         * were counting flicker (see IN_OUT_TRUSTED_FROM).
         */
        const atDoor = cams[r.camera_id]?.location === "entrance";
        const trusted = atDoor && r.ts >= IN_OUT_TRUSTED_FROM;
        return {
          camera_id: r.camera_id, timestamp: new Date(r.ts).toISOString(), attendance: r.current,
          // Kept in the database, withheld here: before the fix these were
          // counting flicker rather than people (see IN_OUT_TRUSTED_FROM).
          total_entries: trusted ? r.entries : null, total_exits: trusted ? r.exits : null,
          in_out_known: trusted,
          // The figures as recorded, whether or not Kyro will stand behind
          // them. Nothing is deleted — it is only kept out of the charts — and
          // an administrator can ask to see the shape of a day anyway, clearly
          // labelled. Separate fields so nothing that reads total_entries can
          // pick these up by accident and present them as fact.
          raw_entries: r.entries, raw_exits: r.exits,
          occupancy_pct: r.capacity ? Math.round((r.current / r.capacity) * 1000) / 10 : 0,
        };
      });
  }

  /**
   * Phone alerts when a room fills up. Each phone decides its own levels
   * (Notifications page: "filling up" / "over capacity"); here we only send
   * when the room crosses upwards past a new 5% step (each phone is then only
   * told when it reaches that phone's own level — see notifyCount). A room has
   * to empty by 10% before the same step alerts again, so a count wobbling
   * around a level doesn't keep buzzing phones.
   */
  async capacityAlerts(cams, live) {
    const marks = await this.get("alert_marks", {});
    let dirty = false;
    for (const [id, l] of Object.entries(live)) {
      const c = cams[id];
      // A room is "filling up" against a capacity somebody MEASURED. Against
      // one Kyro guessed from a picture, it is a phone alert built on a
      // guess — see syncCapacity.
      if (!c || c.hidden || !c.zone_capacity || c.capacity_from !== "admin" || !this.isOnline(l)) continue;
      const frac = (l.current || 0) / c.zone_capacity;
      const m = marks[id] || { frac: 0, at: 0 };
      if (frac < m.frac - 0.1) { marks[id] = { frac, at: m.at }; dirty = true; continue; }
      if (Math.floor(frac * 20) > Math.floor(m.frac * 20) && frac >= 0.5) {
        // A room hovering around a mark mustn't buzz everyone's phone over and over:
        // at most one "filling up" alert per room every 10 minutes. "Full" always goes out.
        const nowFull = frac >= 1 && m.frac < 1;
        if (!nowFull && Date.now() - m.at < ALERT_GAP_MS) continue;
        const prev = m.frac;
        marks[id] = { frac, at: Date.now() }; dirty = true;
        this.ctx.waitUntil(notifyCount(this.env, {
          kind: "camera", zone: c.zone_name || c.name, count: l.current, capacity: c.zone_capacity, prev_fraction: prev,
        }).catch(() => {}));
      }
    }
    if (dirty) await this.ctx.storage.put("alert_marks", marks);
  }

  /**
   * Arrivals and departures for one day, hour by hour, with the busiest hour.
   * Read from the venue total rising and falling, the same way as the summary,
   * and only for times Kyro can stand behind (see IN_OUT_TRUSTED_FROM).
   * ?date=YYYY-MM-DD&tz=Europe/London
   */
  async movementByDay(url) {
    const date = url.searchParams.get("date") || "";
    const tz = url.searchParams.get("tz") || "UTC";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000, end = start + 52 * 3600_000;
    const rows = this.ctx.storage.sql.exec(
      "SELECT camera_id, ts, current, entries, exits FROM history WHERE deleted_at IS NULL AND ts >= ? AND ts < ? ORDER BY ts", start, end).toArray();
    const fmt = this.dateFmt(tz);
    let hourFmt;
    try { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }); }
    catch { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }); }
    const STALE = 3 * 60_000;
    const arrivals = new Array(24).fill(0), departures = new Array(24).fill(0), busiest = new Array(24).fill(0);
    const last = new Map();
    // Each camera's running totals of people who arrived and left, as its own
    // tracker counted them. See the note on countedMovement above for why
    // arrivals are NOT worked out from changes in the number in the room.
    const counters = new Map();
    // Arrivals and departures come from the DOOR when there is a camera on
    // one. A room camera's "entries" is not arrivals: it counts every person
    // it notices, and over a couple of hours of people standing up, turning
    // round and being hidden behind each other it notices the same
    // congregation again and again.
    const doorIds = new Set(Object.values(await this.get("cameras", {}))
      .filter((c) => c.location === "entrance").map((c) => c.camera_id));
    let known = false, peak = 0, peakHour = null;
    for (const r of rows) {
      if (fmt.format(new Date(r.ts)) !== date) continue;

      last.set(r.camera_id, { current: r.current || 0, ts: r.ts });
      let total = 0;
      for (const [k, v] of last) {
        if (r.ts - v.ts > STALE) { last.delete(k); continue; }
        total += v.current;
      }
      const hour = Number(hourFmt.format(new Date(r.ts))) % 24;
      if (total > busiest[hour]) busiest[hour] = total;
      if (total > peak) { peak = total; peakHour = hour; }
      // …and only a door camera's rows are put through it. doorIds was
      // worked out above and then not used, so a room camera's "entries"
      // reached this chart after all — the same leak as in history().
      if (doorIds.has(r.camera_id) && r.ts >= IN_OUT_TRUSTED_FROM
          && countedMovement(counters, r, arrivals, departures, hour)) known = true;
    }
    return {
      date, in_out_known: known, peak, peak_hour: peakHour,
      hours: arrivals.map((arrived, hour) => ({ hour, arrived, left: departures[hour], most: busiest[hour] })),
    };
  }

  // ── Deleting a day's counts ──────────────────────────────────────────────
  // What was deleted is kept for DELETED_KEPT_DAYS so it is never invisible,
  // then it goes for good.

  async deletedDays() {
    const log = await this.get("deleted_days", []);
    const cutoff = Date.now() - DELETED_KEPT_DAYS * 86400_000;
    const keep = log.filter((d) => Date.parse(d.deleted_at) > cutoff).map((d) => {
      if (d.recoverable === false || d.from === undefined) return { ...d, recoverable: false };
      const n = this.ctx.storage.sql.exec(
        "SELECT COUNT(*) AS n FROM history WHERE deleted_at IS NOT NULL AND ts >= ? AND ts <= ?", d.from, d.to).toArray()[0]?.n ?? 0;
      return { ...d, recoverable: n > 0 };
    });
    if (keep.length !== log.length) {
      // Past bringing back: now the rows really go.
      this.ctx.storage.sql.exec("DELETE FROM history WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff);
      this.ctx.storage.sql.exec("DELETE FROM people WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff);
      await this.ctx.storage.put("deleted_days", keep.map(({ recoverable, ...d }) => d));
    }
    return keep;
  }

  /** Brings a deleted day back, if it hasn't yet been cleared for good. */
  async restoreDay(date, user) {
    const log = await this.deletedDays();
    const entry = log.find((d) => d.date === date);
    if (!entry) return json({ error: "That day isn't in the recently deleted list — it may have been cleared for good" }, 404);
    // Days deleted before recovery existed have no saved range, and their rows
    // were really removed rather than marked. Work out the range from the date
    // so those that CAN come back do, and never claim success when nothing did.
    const from = entry.from ?? Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000;
    const to = entry.to ?? from + 52 * 3600_000;
    const can = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) AS n FROM history WHERE deleted_at IS NOT NULL AND ts >= ? AND ts <= ?", from, to).toArray()[0]?.n ?? 0;
    if (!can) {
      return json({ error: "Those counts can't be brought back — they were deleted before Kyro could undo it, and were removed outright at the time." }, 410);
    }
    this.ctx.storage.sql.exec("UPDATE history SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND ts >= ? AND ts <= ?", from, to);
    this.ctx.storage.sql.exec("UPDATE people SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND first_at >= ? AND first_at <= ?", from, to);
    await this.ctx.storage.put("deleted_days", log.filter((d) => d !== entry));
    const back = await this.get("restored_days", []);
    back.unshift({ date, restored_by: clean(user, 60) || "an administrator", restored_at: new Date().toISOString() });
    await this.ctx.storage.put("restored_days", back.slice(0, 100));
    this.lastSample.clear();
    return json({ restored: true, date, attendance: entry.attendance });
  }

  /** Marks every count recorded on one local day as deleted. Undoable for 30 days. */
  async deleteDay(date, tz, user) {
    const fmt = this.dateFmt(tz);
    // A local day can start up to 14 h either side of the UTC date.
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000, end = start + 52 * 3600_000;
    const rows = this.ctx.storage.sql.exec("SELECT ts, current FROM history WHERE deleted_at IS NULL AND ts >= ? AND ts < ?", start, end).toArray();
    const mine = rows.filter((r) => fmt.format(new Date(r.ts)) === date);
    if (!mine.length) return json({ error: "Nothing recorded on that day" }, 404);
    const from = Math.min(...mine.map((r) => r.ts)), to = Math.max(...mine.map((r) => r.ts));
    const peak = Math.max(...mine.map((r) => r.current || 0));
    this.ctx.storage.sql.exec("UPDATE history SET deleted_at = ? WHERE deleted_at IS NULL AND ts >= ? AND ts <= ?", Date.now(), from, to);
    // And the people seen that day. Attendance now comes from the register
    // (see the people table), so a day deleted without this would reappear in
    // Analytics with its attendance untouched.
    this.ctx.storage.sql.exec("UPDATE people SET deleted_at = ? WHERE deleted_at IS NULL AND first_at >= ? AND first_at <= ?", Date.now(), from, to);
    // The cameras' running totals for that day go too, or Analytics shows the day
    // again straight away from the live figures. Counting carries on; if a camera
    // is still running, the day simply starts recording afresh from now.
    const live = await this.get("live", {});
    let touched = false;
    for (const [id, l] of Object.entries(live)) {
      if (fmt.format(new Date(l.updated_at)) !== date) continue;
      live[id] = { ...l, peak: 0, entries: 0, exits: 0 };
      touched = true;
    }
    if (touched) await this.ctx.storage.put("live", live);
    this.lastSample.clear();
    // Any service recorded inside that day goes too — its figures came from these counts.
    const services = await this.get("services", []);
    const left = services.filter((s) => fmt.format(new Date(Date.parse(s.started_at))) !== date);
    if (left.length !== services.length) await this.ctx.storage.put("services", left);
    const log = await this.deletedDays();
    log.unshift({ date, attendance: peak, rows: mine.length, services_removed: services.length - left.length,
      from, to, tz, recoverable: true, deleted_by: clean(user, 60) || "an administrator", deleted_at: new Date().toISOString() });
    await this.ctx.storage.put("deleted_days", log.slice(0, 200));
    return json({ deleted: true, date, attendance: peak });
  }

  /** Each room's highest camera count on a day (for the end-of-service send). */
  async dayPeaks(date, tz) {
    // The day's attendance = the most people in the building AT ONE MOMENT, and
    // each room's share at that moment. (Adding up each camera's own best moment
    // over-counts: two cameras on one hall peak at different times as people move.)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const fmt = this.dateFmt(tz);
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000, end = start + 52 * 3600_000;
    const rows = this.ctx.storage.sql.exec("SELECT camera_id, ts, current FROM history WHERE deleted_at IS NULL AND ts >= ? AND ts < ? ORDER BY ts", start, end).toArray();
    const cams = await this.get("cameras", {});
    const counts = x => cams[x] && !cams[x].hidden && cams[x].location !== "queue";
    const STALE = 3 * 60_000;      // a camera that stopped reporting no longer counts
    const last = new Map();
    let best = 0, bestAt = null;
    for (const r of rows) {
      if (fmt.format(new Date(r.ts)) !== date || !counts(r.camera_id)) continue;
      last.set(r.camera_id, { current: r.current || 0, ts: r.ts });
      let total = 0;
      for (const [id, v] of last) {
        if (r.ts - v.ts > STALE) { last.delete(id); continue; }
        total += v.current;
      }
      if (total > best) { best = total; bestAt = new Map([...last].map(([id, v]) => [id, v.current])); }
    }
    if (!bestAt) return [];
    // Two cameras can cover one room: report the room once, with their sum.
    const byZone = new Map();
    for (const [id, n] of bestAt) {
      if (!n) continue;
      const zone = cams[id].zone_name || cams[id].name;
      byZone.set(zone, (byZone.get(zone) ?? 0) + n);
    }
    return [...byZone].map(([zone, count]) => ({ zone, count }));
  }


  dateFmt(tz) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
  }

  /**
   * Analytics: one point per day (the most people in the building at once),
   * when people arrived (by hour), and a summary. ?days=30&tz=Europe/London[&camera=id]
   */
  async daily(url) {
    const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const tz = url.searchParams.get("tz") || "UTC";
    const camera = url.searchParams.get("camera");
    const since = Date.now() - days * 86400_000;
    const rows = camera
      ? this.ctx.storage.sql.exec("SELECT camera_id, ts, current, capacity, entries, exits, people FROM history WHERE deleted_at IS NULL AND camera_id = ? AND ts >= ? ORDER BY ts", camera, since).toArray()
      : this.ctx.storage.sql.exec("SELECT camera_id, ts, current, capacity, entries, exits, people FROM history WHERE deleted_at IS NULL AND ts >= ? ORDER BY ts", since).toArray();
    // History is saved once a minute; add each camera's count right now so today is up to date.
    const live = await this.get("live", {});
    const cams = await this.get("cameras", {});
    const lastTs = rows.length ? rows[rows.length - 1].ts : 0;
    const now = Object.entries(live)
      .filter(([id, l]) => (!camera || id === camera) && cams[id] && !cams[id].hidden && !cams[id].pending && this.isOnline(l) && l.updated_at > lastTs)
      .map(([id, l]) => ({ camera_id: id, ts: l.updated_at, current: l.current, capacity: cams[id].zone_capacity || 0,
        entries: l.entries || 0, exits: l.exits || 0 }))
      .sort((a, b) => a.ts - b.ts);
    rows.push(...now);
    const fmt = this.dateFmt(tz);
    let hourFmt;
    try { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }); }
    catch { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }); }
    const STALE = 3 * 60_000;  // a camera that stopped reporting no longer counts towards the total
    // A camera on the doorway answers "how many are in the building" far
    // better than a camera on the room, which can only report its own view —
    // a corner of a wide hall. With one on the door, the day's attendance is
    // everyone who came in less everyone who went out, the same figure the
    // live page shows. Without one it is what the cameras could see, as before.
    const doorIds = new Set(Object.values(cams).filter((c) => c.location === "entrance").map((c) => c.camera_id));
    const hasDoors = doorIds.size > 0 && (!camera || doorIds.has(camera));
    const doorRun = new Map();   // camera → running arrivals and departures today
    let doorNet = 0;             // people in the building by the door's count
    /** The doorway's own count of different people — the attendance figure
     *  in a building where no camera sees the whole hall. See below. */
    let doorPeople = 0;
    // Every camera's running arrivals and departures, for the day's total.
    const dayRun = new Map();
    let cameIn = 0;
    const byDay = new Map();   // date → { peak, capacity, at }
    const arrivals = new Array(24).fill(0);
    const departures = new Array(24).fill(0);
    // Movement is read from the venue total rising and falling. Before the
    // tracking fix the count flickered, so those rises and falls were not
    // people coming and going — those days are left out rather than charted.
    let movementDays = 0, lastMovementDay = "";
    let day = "", last = new Map();
    const counters = new Map();
    for (const r of rows) {
      const d = fmt.format(new Date(r.ts));
      if (d !== day) { day = d; last = new Map(); counters.clear(); doorRun.clear(); dayRun.clear(); cameIn = 0; }
      last.set(r.camera_id, { current: r.current || 0, capacity: r.capacity || 0, ts: r.ts });
      let rooms = 0, all = 0, cap = 0, roomCams = 0;
      for (const [k, v] of last) {
        if (r.ts - v.ts > STALE) { last.delete(k); continue; }
        all += v.current;
        cap += v.capacity;
        // A doorway camera's own view is people standing in a doorway, which
        // is not part of how many are in the building — unless a doorway
        // camera is all there is, in which case it is all we have.
        if (!doorIds.has(k)) { rooms += v.current; roomCams++; }
      }
      let total = roomCams ? rooms : all;
      if (doorIds.has(r.camera_id)) {
        // Running totals, so only the step between readings is people moving;
        // a counter that goes backwards means counting started again, and the
        // new reading is the step. Same rule the arrival chart uses.
        const run = doorRun.get(r.camera_id) ?? { lastIn: null, lastOut: null, in: 0, out: 0 };
        const rin = r.entries || 0, rout = r.exits || 0;
        if (run.lastIn !== null) run.in += rin >= run.lastIn ? rin - run.lastIn : rin;
        if (run.lastOut !== null) run.out += rout >= run.lastOut ? rout - run.lastOut : rout;
        run.lastIn = rin; run.lastOut = rout;
        doorRun.set(r.camera_id, run);
      }
      // The door's net — everyone in less everyone out — is offered as its own
      // figure rather than replacing this one. It is the better measure when
      // the door camera is keeping up, and far the worse when it isn't: on an
      // afternoon with about 900 people in the building it said 106.
      if (hasDoors) {
        let net = 0;
        for (const run of doorRun.values()) net += run.in - run.out;
        doorNet = Math.max(0, net);
      }
      /**
       * The doorway's own count of DIFFERENT people that day.
       *
       * Not the same as its crossings: a doorway camera remembers the people
       * it has already counted, so the usher holding the door is one person
       * and somebody stepping out for a phone call is not a second. In a
       * building where no camera sees the whole hall this is the attendance
       * figure — "the door camera basically needs to do the counting" — and
       * it is what the live card now shows, so the history has to agree.
       *
       * The fullest view, never the sum: a church with a front door and a
       * side door has one congregation.
       */
      if (doorIds.has(r.camera_id)) doorPeople = Math.max(doorPeople, r.people || 0);
      // How many people came in that day — which is what a church means by
      // attendance. "Most at once" is a different number and a much smaller
      // one: a camera sees its own corner of a hall, so on an afternoon with
      // about 900 people in the building the most seen at once was 19. That
      // was being reported as the day's attendance.
      {
        const run = dayRun.get(r.camera_id) ?? { lastIn: null, in: 0 };
        const rin = r.entries || 0;
        if (run.lastIn !== null) run.in += rin >= run.lastIn ? rin - run.lastIn : rin;
        run.lastIn = rin;
        dayRun.set(r.camera_id, run);
        // Cameras watching the same thing are not added together — the fullest
        // view is taken, the same rule rooms already use, so two cameras on one
        // door don't double the morning.
        cameIn = Math.max(...[...dayRun.values()].map((x) => x.in), 0);
      }
      if (r.ts >= IN_OUT_TRUSTED_FROM) {
        const hour = Number(hourFmt.format(new Date(r.ts))) % 24;
        if (countedMovement(counters, r, arrivals, departures, hour) && d !== lastMovementDay) {
          lastMovementDay = d; movementDays++;
        }
      }
      const cur = byDay.get(d);
      if (!cur || total > cur.peak) byDay.set(d, { peak: total, capacity: cap, at: r.ts, door: doorNet, came_in: cameIn, door_people: doorPeople });
      else {
        if (doorNet > (cur.door || 0)) cur.door = doorNet;
        if (cameIn > (cur.came_in || 0)) cur.came_in = cameIn;
        // The doorway's count of different people only ever climbs, and the
        // row that happened to hold the busiest MOMENT is not the row that
        // holds the most people counted all day.
        if (doorPeople > (cur.door_people || 0)) cur.door_people = doorPeople;
      }
    }
    // ── The register of people ────────────────────────────────────────────
    //
    // How many DIFFERENT people were seen each day, and when each of them
    // arrived and left. This is the one source here that counts a person
    // once. Everything above counts crossings: a room camera's "entries" is
    // every person it becomes sure of, and over an afternoon it becomes sure
    // of the same congregation again and again.
    //
    // One person sitting at a desk made eleven of them, and this page showed
    // attendance 11, busiest day 11, average attendance 11 — with "1 seen at
    // once" printed underneath, which was Kyro telling the truth and being
    // ignored by its own arithmetic.
    const byRegister = this.peopleByDay(since, tz);
    // What this building holds — the same answer the live figures use.
    const seats = await this.seatsInBuilding();
    // A day where the cameras never saw anyone (e.g. a quick test) isn't a service.
    const everyDate = new Set([...byDay.keys(), ...byRegister.keys()]);
    const history = [...everyDate].filter((d) => {
      const v = byDay.get(d);
      return (byRegister.get(d)?.people ?? 0) > 0 || (v && (v.peak > 0 || v.came_in > 0));
    }).sort().map((d) => {
      const v = byDay.get(d) ?? { peak: 0, capacity: 0, at: 0, door: 0, came_in: 0, door_people: 0 };
      const reg = byRegister.get(d) ?? null;
      // A day's attendance is how many different people were there.
      //
      // The register first, because it is the only one of these that counts a
      // person once. Then how many the cameras counted walking in, and only
      // then the most seen at once — a floor, never the answer, because no
      // camera sees a whole hall.
      /**
       * A day's attendance: the doorway's count of different people first.
       *
       * It used to be the register's, which is fed by the ROOM cameras —
       * and in a wide hall a camera sees its own corner, so that answered
       * "how many different people were in that corner" under the name
       * attendance. The doorway is the one camera everybody passes.
       *
       * Then the register, then crossings, then the most seen at once — a
       * floor, never the answer.
       */
      const measured = v.door_people > 0 ? v.door_people
        : reg ? reg.people
        : v.came_in > 0 ? v.came_in
        : v.peak;
      /**
       * …held at what the building can hold.
       *
       * "its not accurate, not 302 but 114."
       *
       * The live card was holding its figure at the seat count while this
       * page, one click away, reported the same day as 302 under "Busiest
       * day" and "Average attendance". One number saying two different
       * things on two screens is worse than either of them alone.
       *
       * The ceiling is the seats OR the most the cameras actually saw at one
       * moment, whichever is larger: a reading of the room may lower a
       * figure, it may never deny somebody who was plainly standing in it.
       * The measurement is kept beside it, untouched, so the gap stays
       * visible and nothing here is deleted or rewritten.
       */
      const ceiling = Math.max(seats, v.peak || 0);
      const attendance = seats > 0 ? Math.min(measured, ceiling) : measured;
      return {
        timestamp: new Date(v.at || (reg ? Date.now() : 0)).toISOString(), date: d, attendance,
        /** What was actually counted, when the figure above is being held. */
        attendance_measured: attendance === measured ? null : measured,
        /** The seats it is held at, so a page can say so. */
        attendance_held_at: attendance === measured ? null : ceiling,
        /** Where that figure came from, so a page never has to guess. */
        attendance_from: v.door_people > 0 ? "door" : reg ? "register" : v.came_in > 0 ? "entries" : "seen_at_once",
        /** Different people, counted once each. null before Kyro kept this. */
        people: reg ? reg.people : null,
        /** The most the cameras saw at one moment. A different question. */
        seen_at_once: v.peak,
        /** How many walked in that day, as the cameras counted them. */
        came_in: v.came_in || 0,
        /** What a camera on the door made of the same day, for comparison. */
        door_attendance: v.door || 0,
        occupancy_pct: v.capacity ? Math.round((attendance / v.capacity) * 1000) / 10 : 0,
      };
    });
    const n = history.length;
    // Arrivals and departures by hour, from the register wherever it has
    // anything to say. A person arrives once, when they were first seen, and
    // leaves once, when they were last seen — however many times a camera
    // lost them and found them again in between.
    const regDays = [...byRegister.values()];
    const useRegister = regDays.length > 0;
    if (useRegister) {
      arrivals.fill(0); departures.fill(0);
      for (const v of regDays) for (let h = 0; h < 24; h++) { arrivals[h] += v.arrived[h]; departures[h] += v.left[h]; }
      movementDays = regDays.length;
    }
    const m = movementDays || 1;
    const arrival = arrivals.map((count, hour) => ({
      hour, count, avg_count: Math.round((count / m) * 10) / 10,
      exits: departures[hour], avg_exits: Math.round((departures[hour] / m) * 10) / 10,
    }));
    const summary = {
      // Whether these attendance figures are counts of people arriving, or a
      // fallback to the most seen at once because nothing counted arrivals.
      attendance_is_arrivals: n > 0 && history.some((h) => h.came_in > 0),
      /**
       * Attendance is different people, counted once each, from the register
       * — not crossings. The page says which, because the two can be very far
       * apart and the church has to know which it is reading.
       */
      attendance_from_register: history.some((h) => h.attendance_from === "register"),
      /** Arrivals and departures below are each person once, not every time a
       *  camera became sure of them again. */
      movement_from_register: useRegister,
      from_door: hasDoors,
      // How many of these days have movement Kyro can stand behind.
      movement_days: movementDays, movement_known_from: new Date(IN_OUT_TRUSTED_FROM).toISOString(),
      camera_id: camera || "all", total_sessions: n,
      // "Most at once" stays what it says: the fullest the cameras ever saw
      // the place, not the day's attendance.
      all_time_peak: n ? Math.max(...history.map((h) => h.seen_at_once)) : 0,
      busiest_day: n ? Math.max(...history.map((h) => h.attendance)) : 0,
      /** Days whose attendance is being held at what the room can hold, and
       *  what was counted on them — so a page can say so rather than quietly
       *  showing a smaller number than the record holds. */
      days_held: history.filter((h) => h.attendance_measured !== null).length,
      counted_before_holding: n ? Math.max(...history.map((h) => h.attendance_measured ?? h.attendance)) : 0,
      seats_in_building: seats,
      avg_attendance: n ? Math.round(history.reduce((a, h) => a + h.attendance, 0) / n) : 0,
      avg_occupancy_pct: n ? Math.round((history.reduce((a, h) => a + h.occupancy_pct, 0) / n) * 10) / 10 : 0,
      first_session: n ? history[0].timestamp : null, last_session: n ? history[n - 1].timestamp : null,
    };
    return { history, arrival, summary };
  }

  /** An admin typed in a network camera's address on the website; the box picks it up on its next report. */
  async addStream(request) {
    const body = await request.json().catch(() => ({}));
    const devices = await this.get("devices", {});
    const ids = Object.keys(devices);
    const device_id = body.device_id && devices[body.device_id] ? body.device_id : ids.length === 1 ? ids[0] : null;
    if (!device_id) return json({ error: ids.length ? "Choose which camera computer should run this camera" : "Pair a camera computer first" }, 400);
    const raw = clean(body.url, 500);
    let u;
    try { u = new URL(raw); } catch { return json({ error: "That doesn't look like a camera address (it usually starts with rtsp:// or http://)" }, 400); }
    // What the camera computer can actually open: its OpenCV is built with
    // FFmpeg, which handles these. Not NDI (needs the NDI SDK) and not SRT
    // (needs libsrt, which the installed wheel doesn't carry) — refusing them
    // here with a reason beats accepting an address that could never work.
    if (!["rtsp:", "rtsps:", "http:", "https:", "rtmp:", "rtmps:"].includes(u.protocol)) {
      return json({ error: `Kyro can't open a ${u.protocol.replace(":", "")} stream. It reads rtsp://, rtmp://, http:// and https:// (MJPEG). For an NDI or SRT transmitter, send the receiver's HDMI into a USB capture card instead — that works with no address at all.` }, 400);
    }
    return json({ camera_id: await this.createNetworkCamera(device_id, raw, body) });
  }

  async createNetworkCamera(device_id, raw, body) {
    const u = new URL(raw);
    const cams = await this.get("cameras", {});
    const n = Object.keys(cams).length + 1;
    const key = `net-${b64url(crypto.getRandomValues(new Uint8Array(4)))}`;
    const camera_id = `${device_id}:${key}`;
    const name = clean(body.name, 60) || `Camera ${n}`;
    cams[camera_id] = {
      camera_id, device_id, key, kind: "network", name, zone_name: clean(body.zone_name, 60) || name,
      zone_capacity: num(body.zone_capacity, 0, 100000), zone_order: n, location: "indoor", hidden: false,
      address: `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`,  // shown on the website — never the login
      created_at: new Date().toISOString(),
    };
    const urls = await this.get("streams", {});
    urls[camera_id] = raw;
    await this.ctx.storage.put("cameras", cams);
    await this.ctx.storage.put("streams", urls);
    return camera_id;
  }

  // ── Who is signed in ──────────────────────────────────────────────────────
  // One person can be in two places at once — a laptop and a phone are two
  // sessions of the same account. Each browser says it is still here every
  // half minute; anything not heard from for PRESENCE_STALE_MS has gone.

  async hereNow(request, username, name, role) {
    if (!username) return json({ ok: true });
    const body = await request.json().catch(() => ({}));
    const device = clean(body.device, 40);           // this browser's own id
    if (!device) return json({ ok: true });
    const now = Date.now();
    const mine = this.presence.get(username) ?? new Map();
    // Tidy this account's own stale browsers as we go, so memory stays small
    // even if no administrator ever opens the list.
    for (const [id, d] of mine) if (now - d.at > PRESENCE_STALE_MS) mine.delete(id);
    mine.set(device, { name: name || username, role, kind: clean(body.kind, 20) || "computer", at: now });
    // Nobody is signed in from 20 places at once; if ids keep changing, keep
    // the newest and drop the rest rather than growing without limit.
    if (mine.size > MAX_SESSIONS_PER_USER) {
      for (const [id] of [...mine].sort((a, b) => a[1].at - b[1].at).slice(0, mine.size - MAX_SESSIONS_PER_USER)) mine.delete(id);
    }
    this.presence.set(username, mine);
    return json({ ok: true, here: this.whoIsHere().people_here });
  }

  /** A browser being closed or put away: drop it straight away, don't wait. */
  async goneNow(request, username) {
    const body = await request.json().catch(() => ({}));
    const device = clean(body.device, 40);
    const mine = username && device ? this.presence.get(username) : null;
    if (mine) {
      mine.delete(device);
      if (!mine.size) this.presence.delete(username);
    }
    return json({ ok: true });
  }

  whoIsHere() {
    const now = Date.now();
    const users = [];
    let sessions = 0;
    for (const [username, devices] of this.presence) {
      for (const [id, d] of devices) if (now - d.at > PRESENCE_STALE_MS) devices.delete(id);
      if (!devices.size) { this.presence.delete(username); continue; }
      const list = [...devices.values()].sort((a, b) => b.at - a.at);
      sessions += list.length;
      users.push({
        username, name: list[0].name, role: list[0].role,
        sessions: list.length,
        devices: list.map((d) => ({ kind: d.kind, seconds_ago: Math.round((now - d.at) / 1000) })),
        last_seen: new Date(list[0].at).toISOString(),
      });
    }
    users.sort((a, b) => a.name.localeCompare(b.name));
    return { people_here: users.length, sessions, users };
  }

  // ── AI questions ───────────────────────────────────────────────────────────
  // The camera computer's AI asks when it isn't sure ("did they go on stage?",
  // "is this a seat?"). Questions wait here for an admin / operator; the answer
  // goes back to that camera computer on its next report.

  async addQuestions(list) {
    const qs = await this.get("questions", {});
    for (const q of list) qs[q.review_id] = q;
    // Keep the newest 60 (unanswered ones expire after QUESTION_TTL_MS anyway).
    const sorted = Object.values(qs).sort((a, b) => b.created_at - a.created_at);
    const keep = sorted.slice(0, 60);
    // Both of a same-person question's pictures go with it. This deleted
    // only the old single-picture key, so every two-sided question ever
    // dropped left two pictures of people behind in storage for good —
    // which is a leak, and worse than a leak: they are crops of
    // congregants, kept past the question that justified them.
    for (const q of sorted.slice(60)) {
      await this.ctx.storage.delete(`qsnap:${q.review_id}`);
      await this.ctx.storage.delete(`qsnap:${q.review_id}:a`);
      await this.ctx.storage.delete(`qsnap:${q.review_id}:b`);
    }
    await this.ctx.storage.put("questions", Object.fromEntries(keep.map((q) => [q.review_id, q])));
  }

  /**
   * The register's guesses, turned into questions a human can answer.
   *
   * ── Why ─────────────────────────────────────────────────────────────────
   *
   * "uno the system can rather ask me questions like is this the same person?
   * and screenshot them just for the AI count to be more trained and for it
   * to not double count".
   *
   * Kyro already knows when it is guessing — a coat that matched well but not
   * clearly, a new entry made while somebody on file looked almost the same.
   * Those guesses became numbers on a screen with nothing to show for them.
   * Now each one becomes a question with two pictures, and the answer
   * corrects the register there and then.
   *
   * The pictures are asked for from the browser doing the counting, which is
   * the only thing that has them. A question with only one side, or none, is
   * never shown: two names and a similarity score is not something anybody
   * can answer.
   *
   * @returns what pictures to ask for, for this report's reply.
   */
  async makeAsks(cams, now) {
    const wanted = [];
    const asks = this.register?.takeAsks?.() ?? [];
    if (asks.length) {
      const qs = await this.get("questions", {});
      let live = Object.values(qs).filter((q) => q.review_type === "same_person_question" && !q.answer).length;
      for (const a of asks) {
        if (live >= MOST_ASKS) break;
        const id = `${a.kind === "person" ? "isperson" : "same"}-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
        const cam = cams[a.camera];
        const otherCam = cams[a.other_camera] ?? cam;
        // "Is this a person?" has one picture and one thing to decide. It is
        // the same machinery — a guess, a picture, an answer that corrects
        // the register — asking a different question.
        if (a.kind === "person") {
          qs[id] = {
            type: "review_request", review_id: id, camera_id: a.camera,
            review_type: "is_this_a_person", target_role: "operator",
            question: "Is this a person?",
            guess: "person", score: null, had_face: !!a.had_face,
            why: clean(a.reason, 120),
            where: clean(cam?.zone_name || cam?.name || "", 60), other_where: "",
            ask: { pair: a.pair, kind: "person", camera: a.camera, track: a.track },
            track_id: a.track, position: [0, 0], bbox_hint: null,
            confidence: 0, best_guess: "A person",
            options: ["Yes, a person", "No, not a person"],
            created_at: now / 1000,
            pictures: 0,
          };
          live++;
          wanted.push({ id, side: "a", camera_id: a.camera, track: a.track });
          continue;
        }
        qs[id] = {
          type: "review_request", review_id: id, camera_id: a.camera,
          review_type: "same_person_question", target_role: "operator",
          question: "Is this the same person?",
          // What Kyro did and why, in the words of the thing that did it.
          guess: a.guess, score: a.score ?? null, had_face: !!a.had_face,
          why: clean(a.reason, 120),
          where: clean(cam?.zone_name || cam?.name || "", 60),
          other_where: clean(otherCam?.zone_name || otherCam?.name || "", 60),
          /** What to correct if the answer disagrees. Never shown. */
          /**
           * What to correct if the answer disagrees. Never shown.
           *
           * other_camera is carried because the second picture may come from
           * a DIFFERENT camera — that is half the point of the question —
           * and the check that decides whether a computer may send that
           * picture reads it. Without it, that check fell back to the
           * question's own camera, so two computers each watching one side
           * of a doorway could never complete a question between them.
           */
          ask: { pair: a.pair, guess: a.guess, camera: a.camera, track: a.track, person: a.person,
                 other_camera: a.other_camera ?? null, made: a.made ?? null },
          track_id: a.track, position: [0, 0], bbox_hint: null,
          confidence: a.score ?? 0, best_guess: a.guess === "same" ? "Same person" : "Different people",
          options: ["Same person", "Different people", "Not sure"],
          created_at: now / 1000,
          /** No pictures yet. Until both arrive the question is not shown. */
          pictures: 0,
        };
        live++;
        wanted.push({ id, side: "a", camera_id: a.camera, track: a.track });
        if (a.other_track !== null && a.other_track !== undefined) {
          wanted.push({ id, side: "b", camera_id: a.other_camera, track: a.other_track });
        }
      }
      await this.ctx.storage.put("questions", qs);
      /**
       * …and tell the phones there is something to answer.
       *
       * "AI review question — AI is unsure and needs your answer" has been
       * on the Notifications page since it was written, with nothing
       * anywhere to send it. Kyro asking a question nobody is told about is
       * Kyro not asking.
       *
       * At most one in ten minutes, and one tag for all of them: five
       * questions should light a phone once, not five times.
       */
      if (live > 0 && now - (this.toldAboutQuestions ?? 0) > ASK_ALERT_GAP_MS) {
        this.toldAboutQuestions = now;
        this.ctx.waitUntil(notifyCount(this.env, {
          kind: "question", zone: "", count: 0,
        }).catch(() => {}));
      }
      this.wantPictures = wanted;
      this.wantPicturesAt = now;
    }
    // Keep asking until the pictures arrive or the question gives up.
    if (!wanted.length && this.wantPictures?.length && now - (this.wantPicturesAt ?? 0) < ASK_PICTURE_WAIT_MS) {
      return this.wantPictures;
    }
    if (!wanted.length && now - (this.wantPicturesAt ?? 0) >= ASK_PICTURE_WAIT_MS) this.wantPictures = [];
    return wanted;
  }

  /**
   * "Is this the same chair?" — two cameras, two pictures, one answer.
   *
   * Two cameras pointed at one hall each find their own seats, so one chair
   * becomes two and one person sitting in it looks like two people in two
   * seats. Kyro works out which pairs are suspect on its own, and it does it
   * honestly: not on appearance — two chairs side by side are identical from
   * a camera — but on WHO SITS THERE. The same person, in both, at the same
   * moment, again and again. Nobody is in two places at once.
   *
   * What it will not do is decide. Two chairs in a row can produce that
   * pattern if the register ever confuses two people, so the last step is a
   * person's.
   *
   * This used to be asked on the seating page, as a list of pairs of seat
   * ids with a tally beside them — "S37 and S24 — same person in both 81
   * times". Nobody can answer that: the ids mean nothing and there is
   * nothing to look at. "if ever the system does not know, thats when
   * questions would be able to come up." So it is asked the way Kyro asks
   * everything else it does not know: a picture of each chair, side by side,
   * and two buttons.
   *
   * Asked once per pair. The answer is applied to the building immediately —
   * see answerQuestion.
   */
  async askAboutSameChair(cams, now) {
    const b = await this.theBuilding();
    const pairs = b.proposals();
    /**
     * A request that ran out of time is withdrawn, and the pair goes back
     * into the queue.
     *
     * Nobody was at those two seats while it was waiting. Leaving the
     * question in place would leave an unanswerable one lying about for the
     * rest of the day, and leaving the pair marked as asked would mean the
     * duplicate was never put to anybody at all — the chair would go on
     * being counted twice, silently, which is the whole thing this is for.
     */
    const lapsed = (this.chairWants ?? []).filter((w) => now - w.at >= CHAIR_PICTURE_WAIT_MS);
    if (lapsed.length) {
      const qs = await this.get("questions", {});
      const asked = await this.get("chairs_asked", {});
      let dropped = false;
      for (const w of lapsed) {
        const q = qs[w.id];
        this.chairWants = this.chairWants.filter((x) => x.id !== w.id);
        if (!q || q.answer || (q.pictures ?? 0) >= 2) continue;
        delete qs[w.id];
        delete asked[[...(q.ask?.views ?? [])].sort().join("|")];
        dropped = true;
      }
      if (dropped) {
        await this.ctx.storage.put("questions", qs);
        await this.ctx.storage.put("chairs_asked", asked);
      }
    }
    const qs = await this.get("questions", {});
    const asked = await this.get("chairs_asked", {});
    /**
     * Only ever ask for a picture that is still wanted.
     *
     * A question that has been answered, or has both its pictures, needs
     * nothing more — and this used to return before reaching that test
     * whenever there were no pairs left to put. Answering "yes, the same
     * person" merges the two seats, which leaves no pair, which took that
     * early way out: both cameras went on sending a crop of somebody every
     * two seconds, for ten minutes, for a question already settled.
     */
    const stillWanted = () => (this.chairWants ?? [])
      .filter((w) => qs[w.id] && !qs[w.id].answer && !qs[w.id].sides?.[w.side]);
    if (!pairs.length) return stillWanted();
    let live = Object.values(qs).filter((q) => q.review_type === "same_chair_question" && !q.answer).length;
    const want = [];
    for (const p of pairs) {
      if (live >= 2) break;                    // two at a time, never a list
      const mark = [...p.views].sort().join("|");
      if (asked[mark]) continue;
      const [camA, camB] = p.cameras;
      const a = cams[camA], c = cams[camB];
      // A question about a camera that isn't running can never get its
      // picture, so it would sit unanswerable until it expired.
      if (!a || !c || a.hidden || a.pending || c.hidden || c.pending) continue;
      const seatNo = (view) => {
        const m = /#K(\d+)$/.exec(view);
        return m ? Number(m[1]) : null;
      };
      const nA = seatNo(p.views[0]), nB = seatNo(p.views[1]);
      if (nA === null || nB === null) continue;
      asked[mark] = now;
      live++;
      const id = `chair-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
      qs[id] = {
        type: "review_request", review_id: id, camera_id: camA,
        review_type: "same_chair_question", target_role: "operator",
        question: "Is this the same person?",
        guess: "same", score: p.confidence ?? null, had_face: false,
        why: `the same person was in both of these at the same moment, ${p.agreements} times`,
        where: clean(a.zone_name || a.name || "", 60),
        other_where: clean(c.zone_name || c.name || "", 60),
        /** What to do with the answer. Never shown. other_camera is read by
         *  the check that decides whether a computer may send the second
         *  picture — the two halves may be on two different computers. */
        ask: { kind: "chair", camera: camA, other_camera: camB,
               views: [p.views[0], p.views[1]], keep: p.keep, drop: p.drop },
        track_id: null, position: [0, 0], bbox_hint: null,
        confidence: p.confidence ?? 0, best_guess: "The same person",
        options: ["Yes, the same person", "No, different people"],
        created_at: now / 1000,
        pictures: 0,
      };
      // A picture of whoever is SITTING in each, not of the two chairs.
      // "uno a chair is meant to look the same, its the person that you
      // should be focusing on, because chairs are usually identical."
      want.push({ id, side: "a", camera_id: camA, seat: nA, who: true, at: now });
      want.push({ id, side: "b", camera_id: camB, seat: nB, who: true, at: now });
    }
    if (want.length) {
      await this.ctx.storage.put("questions", qs);
      await this.ctx.storage.put("chairs_asked", asked);
      // Added to, not replacing: a pair still waiting for somebody to sit
      // for somebody must not lose its request because another came up.
      this.chairWants = [...(this.chairWants ?? []), ...want];
    }
    // Keep offering until the pictures arrive or the request lapses — but
    // only the half that is still missing. Both halves may be on different
    // computers, and each only ever sees its own.
    return stillWanted();
  }

  /**
   * "Is this a seat?" — one question per chair Kyro cannot settle.
   *
   * The seat finder already decides this for itself wherever it can: a place
   * people sit in again and again is a seat, and so is a chair the AI sees
   * plainly. What it will not decide alone is somebody standing very upright
   * in one spot, or a seat nowhere near any other seat in a hall full of
   * rows — because both are as likely to be a person who stood still as a
   * chair nobody uses.
   *
   * Asked once each. A hall of a hundred chairs must not become a hall of a
   * hundred questions, so the camera offers a few at a time and this
   * remembers which have already been put.
   */
  async askAboutSeats(asks, cams, now) {
    const qs = await this.get("questions", {});
    const asked = await this.get("seats_asked", {});
    const want = [];
    let added = 0;
    for (const a of asks) {
      const mark = `${a.camera_id}#${a.seat}`;
      if (asked[mark]) continue;
      if (added >= 3) break;                      // a few at a time, never a flood
      added++;
      asked[mark] = now;
      const id = `seat-${a.camera_id.replace(/[^\w-]/g, "")}-${a.seat}`;
      const cam = cams[a.camera_id];
      qs[id] = {
        type: "review_request", review_id: id, camera_id: a.camera_id,
        review_type: "is_this_a_seat", target_role: "operator",
        question: "Is this a seat?",
        guess: "seat", score: null, had_face: false,
        why: "somebody was in this spot again and again, but it does not look like the other seats",
        where: clean(cam?.zone_name || cam?.name || "", 60), other_where: "",
        ask: { kind: "seat", camera: a.camera_id, seat: a.seat },
        track_id: null, position: [0, 0], bbox_hint: null,
        confidence: 0, best_guess: "A seat",
        options: ["Yes, a seat", "No, not a seat"],
        created_at: now / 1000,
        pictures: 0,
      };
      want.push({ id, side: "a", camera_id: a.camera_id, seat: a.seat });
    }
    if (!want.length) return [];
    await this.ctx.storage.put("questions", qs);
    // Kept for good: a seat asked about once has been asked about, and a
    // hall of a hundred chairs must not become a hundred questions a week.
    await this.ctx.storage.put("seats_asked", asked);
    return want;
  }

  async listQuestions(role) {
    const now = Date.now() / 1000;
    return Object.values(await this.get("questions", {}))
      .filter((q) => !q.answer && (role === "admin" || q.target_role !== "admin")
        && now - q.created_at < (q.review_type === "same_chair_question" ? CHAIR_QUESTION_TTL_MS : QUESTION_TTL_MS) / 1000)
      // "Is this the same person?" without the two pictures is two names and
      // a number. Nobody can answer that, so it is not asked.
      .filter((q) => q.review_type !== "same_person_question" || (q.pictures ?? 0) >= 2)
      // …and "is this the same chair?", which is two chairs or it is nothing.
      .filter((q) => q.review_type !== "same_chair_question" || (q.pictures ?? 0) >= 2)
      // …and one for "is this a person?", which has only one thing to show.
      .filter((q) => !["is_this_a_person", "is_this_a_seat"].includes(q.review_type) || (q.pictures ?? 0) >= 1)
      .sort((a, b) => a.created_at - b.created_at)
      .map(({ answer, answered_by, answered_at, ...q }) => q);
  }

  async questionSnapshot(device, request, url) {
    const id = clean(url.searchParams.get("id"), 60);
    // "Is this the same person?" has two pictures, not one. Any other
    // question still has exactly one, under its own key, as before.
    const side = ["a", "b"].includes(url.searchParams.get("side")) ? url.searchParams.get("side") : null;
    const buf = await request.arrayBuffer();
    if (!id || buf.byteLength > 120_000) return json({ error: "Bad picture" }, 400);   // storage values are ≤128 KB
    const qs = await this.get("questions", {});
    const q = qs[id];
    if (!q) return json({ error: "No such question" }, 404);
    // A picture for a same-person question may come from a DIFFERENT camera
    // than the one the question is filed under — the two sides are two
    // sightings, and the whole point is that they may be on two cameras. It
    // still has to be a camera on the computer that is sending it.
    const mine = q.camera_id.startsWith(`${device.id}:`)
      || (side && [q.ask?.camera, q.ask?.other_camera].some((c) => c && c.startsWith(`${device.id}:`)));
    if (!mine) return json({ error: "No such question" }, 404);
    await this.ctx.storage.put(`qsnap:${id}${side ? `:${side}` : ""}`, new Uint8Array(buf));
    if (side) {
      // Which sides are in. A chair question may wait ten minutes for
      // somebody to sit down, and without this it would go on asking both
      // cameras for a picture it already has, every few seconds, for all of
      // them. See askAboutSameChair.
      q.sides = { ...(q.sides ?? {}), [side]: true };
      // Shown only once both sides have arrived.
      const have = await this.ctx.storage.get(`qsnap:${id}:${side === "a" ? "b" : "a"}`);
      q.pictures = have ? 2 : 1;
      await this.ctx.storage.put("questions", qs);
    }
    return json({ ok: true });
  }

  async getQuestionSnapshot(id, role, side = null) {
    const q = (await this.get("questions", {}))[id];
    if (q && q.target_role === "admin" && role !== "admin") return json({ error: "Only an administrator sees this one" }, 403);
    const img = await this.ctx.storage.get(`qsnap:${id}${side ? `:${side}` : ""}`);
    if (!img) return new Response(null, { status: 204 });
    return new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
  }

  async answerQuestion(id, role, user, request) {
    if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can answer" }, 403);
    const body = await request.json().catch(() => ({}));
    const qs = await this.get("questions", {});
    const q = qs[id];
    if (!q) return json({ error: "That question has expired" }, 404);
    if (q.target_role === "admin" && role !== "admin") return json({ error: "Only an administrator can answer this one" }, 403);
    if (q.answer) return json({ ok: true, already: true });
    q.answer = clean(body.answer, 40) || "ignore";
    q.answered_by = clean(user, 60); q.answered_at = Date.now();

    // "Is this the same person?" is answered here rather than sent back to a
    // camera: it is the REGISTER that guessed, so the register is what has to
    // be corrected — and it is corrected now, so the attendance figure moves
    // while the person who answered is still looking at it.
    let result = null;
    if (q.review_type === "is_this_a_person") {
      // "No" is the one that changes anything: the entry goes, the figures
      // follow in the same breath, and what it looked like is remembered so
      // the same cushion is not counted again this service.
      if (/^no/i.test(q.answer) && this.register && q.ask) {
        result = this.register.notAPerson(q.ask.camera, q.ask.track) ?? { changed: false };
        if (result.removed) {
          result = { changed: true, action: "removed", people: result.people };
          this.forgetPeopleRows(this.register.service);
          this.savePeople(this.register.service);
          try {
            await this.ctx.storage.put("register", this.register.snapshot(SAFE_VALUE_BYTES));
          } catch (e) {
            await this.wrong("Register of people", "Couldn't save the correction you just made", e && e.message);
          }
        }
      } else {
        result = { changed: false, agreed: true };
      }
      await this.ctx.storage.put("questions", qs);
      await this.ctx.storage.delete(`qsnap:${id}:a`);
      await this.ctx.storage.delete(`qsnap:${id}:b`);
      await this.ctx.storage.delete(`qsnap:${id}`);
      return json({ ok: true, ...result });
    }
    /**
     * "Is this the same chair?" — answered here, not sent to a camera.
     *
     * It is the BUILDING that holds the duplicate, so the building is what
     * the answer corrects, and it corrects it now: "yes" joins the two seats
     * into one so the hall stops counting the chair twice, "no" settles the
     * pair for good so it is never put again.
     *
     * No version is passed. The question was asked of whoever is looking,
     * and a seat somebody confirmed on another page in the meantime is not a
     * reason to throw their answer away.
     */
    if (q.review_type === "same_chair_question") {
      const yes = /^yes/i.test(q.answer);
      const bl = await this.theBuilding();
      const who = clean(user, 60);
      if (yes) result = bl.merge(q.ask?.keep, q.ask?.drop, who, undefined);
      else result = bl.notOneChair(q.ask?.views?.[0], q.ask?.views?.[1], who, undefined);
      if (result?.ok) await this.saveBuilding(true);
      await this.ctx.storage.put("questions", qs);
      await this.ctx.storage.delete(`qsnap:${id}:a`);
      await this.ctx.storage.delete(`qsnap:${id}:b`);
      await this.ctx.storage.delete(`qsnap:${id}`);
      return json({ ok: true, changed: !!result?.ok, action: yes ? "one_chair" : "two_chairs",
                    ...(result?.error ? { error: result.error } : {}) });
    }
    if (q.review_type === "same_person_question") {
      const said = /^same/i.test(q.answer) ? true : /^different/i.test(q.answer) ? false : null;
      if (said !== null && this.register && q.ask) {
        result = this.register.answerAsk(q.ask, said);
        // The figures come off the screen now, not at the next save. "Put
        // the number down" means while she is looking at it.
        this.forgetPeopleRows(this.register.service);
        this.savePeople(this.register.service);
        await this.learnFromAnswer(q, said, result);
        await this.maybeMoveTheLine();
        try {
          await this.ctx.storage.put("register", this.register.snapshot(SAFE_VALUE_BYTES));
        } catch (e) {
          await this.wrong("Register of people", "Couldn't save the correction you just made", e && e.message);
        }
      }
      await this.ctx.storage.put("questions", qs);
      // Both pictures go the moment the question is answered. They were only
      // ever here to be looked at once.
      await this.ctx.storage.delete(`qsnap:${id}:a`);
      await this.ctx.storage.delete(`qsnap:${id}:b`);
      await this.ctx.storage.delete(`qsnap:${id}`);
      return json({ ok: true, ...(result ?? {}) });
    }

    await this.ctx.storage.put("questions", qs);
    const pending = await this.get("answers", []);
    pending.push({ device_id: q.camera_id.split(":")[0], key: q.camera_id.slice(q.camera_id.indexOf(":") + 1),
      review_id: id, answer: q.answer, kind: q.review_type,
      // Which seat it was about. The camera is the only thing that knows
      // where its seats are, so an answer without this changes nothing.
      ...(q.ask?.kind === "seat" ? { seat: q.ask.seat } : {}) });
    await this.ctx.storage.put("answers", pending.slice(-200));
    await this.ctx.storage.delete(`qsnap:${id}`);
    return json({ ok: true });
  }

  /**
   * What the answer taught Kyro.
   *
   * ── What this is, and what it is not ────────────────────────────────────
   *
   * "just for the AI count to be more trained ... and eventually the system
   * will be more trained enough to know".
   *
   * It is not retraining the AI. Nothing here changes the model that finds
   * people or the one that reads faces: those are fixed files, the same in
   * every church, and a few hundred answers could not move them.
   *
   * What it does do is real and measurable. Every answer is one labelled
   * example — "two sightings that scored 0.84 alike were / were not the same
   * person" — in THIS building, in THIS lighting, with THESE coats. The
   * number that decides a match is a threshold, and a threshold is exactly
   * the kind of thing a few dozen labelled examples can set properly. So the
   * answers are kept as a score and a yes/no, and the line that would have
   * got the most of them right is worked out from them.
   *
   * Nothing about a person is kept: no picture — both are deleted the moment
   * the question is answered — no face code, no name. A similarity score and
   * a yes or a no.
   */
  async learnFromAnswer(q, same, result) {
    if (typeof q.score !== "number") return;
    const log = await this.get("ask_answers", []);
    log.push({
      at: Date.now(), score: q.score, face: !!q.had_face, same: !!same,
      guess: q.guess, agreed: !!result?.agreed,
    });
    await this.ctx.storage.put("ask_answers", log.slice(-500));
  }

  /**
   * What the answers add up to: how often Kyro was right, and where the line
   * between "same person" and "two people" really sits in this building.
   *
   * The best line is found by trying every answered score as a cut and
   * counting how many answers it would have got right. With few answers that
   * is a weak suggestion and it says so; it is only ever acted on once there
   * are enough of them to mean something. See LOOK_SAME in identity.js for
   * the measured starting point it would be replacing.
   */
  async askLearning() {
    const log = await this.get("ask_answers", []);
    const scored = log.filter((a) => typeof a.score === "number");
    const answered = log.length;
    const agreed = log.filter((a) => a.agreed).length;
    let suggest = null, right = 0;
    if (scored.length >= 8) {
      const cuts = [...new Set(scored.map((a) => a.score))].sort((a, b) => a - b);
      for (const c of cuts) {
        const n = scored.filter((a) => (a.score >= c) === a.same).length;
        if (n > right) { right = n; suggest = c; }
      }
    }
    const using = await this.get("look_same", null);
    return {
      answered,
      agreed,
      /** The line Kyro is actually using, and where it came from. */
      using: using?.value ?? LOOK_SAME,
      using_from: using ? "your answers" : "measured on standard photographs",
      /** The line these answers say would be best, and how sure that is. */
      suggested: suggest,
      suggested_right: scored.length ? Math.round((right / scored.length) * 100) : null,
      examples: scored.length,
      /** Enough answers to be worth acting on. */
      enough: ANSWERS_BEFORE_LEARNING,
    };
  }

  /**
   * Move the line Kyro matches people on, once the answers say so.
   *
   * Only when there are enough of them (ANSWERS_BEFORE_LEARNING), only when
   * the suggested line would get MORE of those answers right than the one in
   * use, and only in small steps — a threshold that lurches about because of
   * one odd pair of coats is worse than one that is slightly wrong and
   * steady. Everything is written down, so a church can see what changed and
   * why, and put it back.
   */
  async maybeMoveTheLine() {
    const l = await this.askLearning();
    if (l.examples < ANSWERS_BEFORE_LEARNING || l.suggested === null) return null;
    const log = (await this.get("ask_answers", [])).filter((a) => typeof a.score === "number");
    const rightAt = (cut) => log.filter((a) => (a.score >= cut) === a.same).length;
    const now = l.using, better = l.suggested;
    if (rightAt(better) <= rightAt(now)) return null;
    // A step at a time, never a jump.
    const next = Math.round(Math.min(0.95, Math.max(0.70, now + Math.sign(better - now) * 0.01)) * 1000) / 1000;
    if (next === now) return null;
    await this.ctx.storage.put("look_same", { value: next, at: Date.now(), from: l.examples });
    if (this.register) this.register.lookSame = next;
    const hist = await this.get("look_same_log", []);
    hist.unshift({ at: new Date().toISOString(), from: now, to: next, answers: l.examples, right: rightAt(next) });
    await this.ctx.storage.put("look_same_log", hist.slice(0, 50));
    return next;
  }

  async takeAnswers(device_id) {
    const all = await this.get("answers", []);
    const mine = all.filter((a) => a.device_id === device_id);
    if (mine.length) await this.ctx.storage.put("answers", all.filter((a) => a.device_id !== device_id));
    return mine.map(({ device_id: _d, ...a }) => a);
  }

  // ── Rota holds, and stage / ignore areas ──────────────────────────────────

  async addRota(request) {
    const body = await request.json().catch(() => ({}));
    const rota = await this.get("rota", []);
    const now = Date.now();
    const added = [];
    let seatIdBudget = 2000;      // across the whole request, so "rota" always fits in one stored value
    // On the live site the seating areas are the camera rooms: an entry for a room
    // applies to that camera (its rows / seats, or the whole room if none are given).
    const rooms = Object.values(await this.get("cameras", {})).filter((c) => !c.hidden);
    const roomFor = (name) => rooms.find((c) => [c.zone_name, c.name].some((n) => n && n.trim().toLowerCase() === String(name).trim().toLowerCase()));
    for (const e of (Array.isArray(body.entries) ? body.entries : []).slice(0, 100)) {
      const start = Date.parse(e.start_time), end = Date.parse(e.end_time);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const entry = {
        entry_id: `rota-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`, label: clean(e.label, 60) || "Rota",
        start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        camera_id: e.camera_id ? clean(e.camera_id, 120) : (e.section && roomFor(e.section)?.camera_id) || null,
        section: e.section ? (roomFor(e.section) ? ((e.rows?.length || e.seat_ids?.length) ? null : "Main") : clean(e.section, 40)) : null,
        rows: (Array.isArray(e.rows) ? e.rows : []).slice(0, 50).map((r) => clean(r, 10)).filter(Boolean),
        seat_ids: (Array.isArray(e.seat_ids) ? e.seat_ids : []).slice(0, Math.max(0, seatIdBudget)).map((s) => clean(s, 40)).filter(Boolean),
        is_active: true,
      };
      seatIdBudget -= entry.seat_ids.length;
      rota.push(entry); added.push(entry);
    }
    // Entries that ended over a day ago are tidied away.
    const keep = rota.filter((e) => Date.parse(e.end_time) > now - 86400_000).slice(-100);
    await this.ctx.storage.put("rota", keep);
    return json({ added });
  }

  /**
   * What the rota says is on, right now and next.
   *
   * ── Why this exists ──────────────────────────────────────────────────────
   *
   * The Rota page said, in so many words, "Kyro will use these times
   * immediately". It did not. A rota entry reached the camera computers and
   * held a few seats; nothing anywhere used its TIMES, and nothing on any
   * screen ever mentioned it again. Reported as: "i tried to put a rota in
   * for the kyro system to know the times etc whats going on but it wasnt
   * working nor was the system aware of it and was working together".
   *
   * This is the one place that answers "what is on", and the service timer,
   * the live figures and every page read it.
   *
   * Overlapping entries are normal — the choir at 09:45 and the service at
   * 10:00 are both on at 10:15. What is ON is all of them; what the service
   * is CALLED is the one that started first, because that is when the morning
   * began; and it runs until the last of them has finished.
   */
  async whatsOn(now = Date.now()) {
    let rota;
    try {
      rota = await this.get("rota", []);
    } catch {
      return { on: [], now: null, until: null, next: null };
    }
    const timed = (Array.isArray(rota) ? rota : [])
      .map((e) => ({ ...e, from: Date.parse(e.start_time), to: Date.parse(e.end_time) }))
      .filter((e) => Number.isFinite(e.from) && Number.isFinite(e.to) && e.to > e.from)
      .sort((a, b) => a.from - b.from);
    const on = timed.filter((e) => e.from <= now && now < e.to);
    const next = timed.find((e) => e.from > now && e.from - now <= ROTA_AHEAD_MS) ?? null;
    const brief = (e) => e && { entry_id: e.entry_id, label: e.label, start_time: e.start_time, end_time: e.end_time };
    return {
      on: on.map(brief),
      /** What to call what is happening: the first thing that started. */
      now: brief(on[0] ?? null),
      /** When the last of them finishes. */
      until: on.length ? Math.max(...on.map((e) => e.to)) : null,
      next: brief(next),
    };
  }

  async removeRota(id) {
    const rota = await this.get("rota", []);
    await this.ctx.storage.put("rota", rota.filter((e) => e.entry_id !== id));
    return json({ removed: true });
  }

  async saveZones(camera_id, request) {
    const body = await request.json().catch(() => ([]));
    const list = (Array.isArray(body) ? body : []).slice(0, 30).map((z) => {
      if (!Array.isArray(z.bbox) || z.bbox.length !== 4) return null;
      return { zone_id: clean(z.zone_id, 40) || `z-${b64url(crypto.getRandomValues(new Uint8Array(4)))}`, label: clean(z.label, 60) || "Area",
        zone_type: z.zone_type === "ignore" ? "ignore" : "hold_seats", bbox: z.bbox.map((v) => Math.round(Number(v) || 0)),
        hold_seats_in_rows: (Array.isArray(z.hold_seats_in_rows) ? z.hold_seats_in_rows : []).slice(0, 50).map((r) => clean(r, 10)).filter(Boolean),
        is_active: z.is_active !== false };
    }).filter(Boolean);
    const all = await this.get("seat_zones", {});
    all[camera_id] = list;
    await this.ctx.storage.put("seat_zones", all);
    return json(list);
  }

  // ── Services: recorded automatically ─────────────────────────────────────
  // A service starts by itself when the cameras see people (SERVICE_START_PEOPLE
  // for SERVICE_START_MS) and ends by itself when the hall has been empty for
  // SERVICE_END_MS. Nobody has to press start or save. When it ends, any face
  // matching data is wiped, and an admin is asked whether to keep the service's
  // record or delete it.

  async trackService(now) {
    const v = await this.venueTotal();
    // Two different jobs, two different figures, and using one for both put
    // "Here now 81" next to "Busiest 19" — which cannot be true of anything.
    //
    // Whether a service is running goes by what the cameras can SEE: it starts
    // when people are in the room and ends when the room is empty, and
    // "everyone counted in less everyone counted out" never comes back down to
    // nothing — one missed departure and a service would record until
    // midnight.
    //
    // How busy it got is the figure every page shows, or the service's own
    // record would contradict what was on the screen all the way through it.
    const seen = v.seen_now ?? v.total_current;
    const people = v.total_current;
    const st = await this.get("service_state", { busy_since: null, quiet_since: null });
    let live = await this.get("service_live", null);
    let dirty = false;
    /**
     * What the church said would be happening now. See whatsOn().
     *
     * With a rota, Kyro is not guessing. Five people for two minutes is how
     * you work out that a service has started when nobody has told you; when
     * somebody HAS told you, waiting for a crowd to prove it is just being
     * slow — the first person through the door at the time the rota says is
     * the service beginning, and it is called what the rota calls it.
     */
    const plan = await this.whatsOn(now);
    const onRota = !!plan.now;
    if (!live) {
      // On the rota: one person is enough, straight away. Off it: the old
      // rule, which has to be sure before it commits to anything.
      const enough = onRota ? 1 : SERVICE_START_PEOPLE;
      const forLong = onRota ? 0 : SERVICE_START_MS;
      if (seen >= enough) {
        if (!st.busy_since) { st.busy_since = now; dirty = true; }
        if (now - st.busy_since >= forLong) {
          // Started when the rota said, not when somebody finally walked in
          // front of a camera — otherwise a service that begins at ten is
          // recorded as beginning at ten past, and every arrival before that
          // falls outside its own service.
          const began = onRota
            ? Math.min(st.busy_since, Math.max(Date.parse(plan.now.start_time), now - 3600_000))
            : st.busy_since;
          live = { id: `svc-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`,
            name: onRota ? plan.now.label : serviceName(began),
            started_at: new Date(began).toISOString(), peak: 0, peak_at: null, rooms: {},
            // Which rota entry this is, so the service timer can end it when
            // the rota says it is over and pages can say what is on.
            ...(onRota ? { rota_entry: plan.now.entry_id, from_rota: true } : {}) };
          this.recentTotals = [];
          st.busy_since = null; st.quiet_since = null;
          await this.ctx.storage.put("service_live", live);
          dirty = true;
        }
      } else if (st.busy_since) { st.busy_since = null; dirty = true; }   // the room emptied again
    } else {
      // "Busiest" only counts a number that held for PEAK_HOLD_MS: a moment's flicker (or the
      // seconds before face matching merges people seen on two cameras) isn't recorded.
      this.recentTotals = [...(this.recentTotals ?? []).filter((x) => now - x.at <= PEAK_HOLD_MS), { at: now, people }];
      const held = this.recentTotals[0].at <= now - PEAK_HOLD_MS / 2 ? Math.min(...this.recentTotals.map((x) => x.people)) : 0;
      if (held > live.peak) { live.peak = held; live.peak_at = new Date(now).toISOString(); }
      // Two cameras can cover one room: add them up, then keep the busiest that room has been.
      const nowByRoom = {};
      for (const z of v.zones) nowByRoom[z.zone_name] = (nowByRoom[z.zone_name] ?? 0) + (z.current || 0);
      for (const [room, n] of Object.entries(nowByRoom)) live.rooms[room] = Math.max(live.rooms[room] ?? 0, n);
      if (seen >= SERVICE_END_PEOPLE) { if (st.quiet_since) { st.quiet_since = null; dirty = true; } }
      else if (!st.quiet_since) { st.quiet_since = now; dirty = true; }
      await this.ctx.storage.put("service_live", live);
      // If every camera computer goes off, no reports come in: a timer still ends the service.
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 5 * 60_000);
      if (st.quiet_since && now - st.quiet_since >= SERVICE_END_MS) {
        await this.finishService(live, st.quiet_since);
        st.quiet_since = null; dirty = true;
      } else if (live.from_rota && !onRota) {
        // The rota says it is over. Services overrun, so Kyro waits a while
        // from the moment the last entry finished — but it does not go on
        // recording "Sunday morning service" into the afternoon because three
        // people stayed behind to stack chairs. See ROTA_OVERRUN_MS.
        const over = await this.get("rota_over_since", null);
        if (!over) await this.ctx.storage.put("rota_over_since", now);
        else if (now - over >= ROTA_OVERRUN_MS) {
          await this.finishService(live, now);
          st.quiet_since = null; dirty = true;
        }
      } else if (live.from_rota) {
        // Back on the rota — the next entry has begun, or the clock moved.
        await this.ctx.storage.delete("rota_over_since");
      }
    }
    if (dirty) await this.ctx.storage.put("service_state", st);
  }

  /**
   * The timer that ends a service when every camera computer has gone off.
   *
   * This threw nowhere. An alarm that throws is RETRIED by Cloudflare, over
   * and over, which does three things at once: the service never ends, the
   * failure is invisible, and the live-cameras server never falls idle — so it
   * never picks up new code either, and a deploy appears to do nothing.
   *
   * So: it catches, it says what went wrong where it can be read, and it
   * always leaves a next alarm set, because the one job it has is to end a
   * service when nobody is left to tell it to.
   */
  async alarm() {
    const now = Date.now();
    let live = null;
    try {
      live = await this.get("service_live", null);
      if (live) await this.trackService(now);
      await this.working("Service timer");
    } catch (e) {
      await this.wrong("Service timer",
        "Couldn't check whether the service should end, so it may keep recording after everyone has gone",
        e && e.message);
    }
    try {
      // Reschedule only while there is something to watch. A service that has
      // ended needs no timer, and a timer with nothing to do is what keeps
      // this object awake for ever.
      const stillLive = await this.get("service_live", null);
      if (stillLive && !(await this.ctx.storage.getAlarm())) {
        await this.ctx.storage.setAlarm(now + 5 * 60_000);
      }
    } catch (e) {
      await this.wrong("Service timer", "Couldn't set the next check", e && e.message);
    }
  }

  async finishService(live, endedMs) {
    const started = Date.parse(live.started_at);
    const rows = this.ctx.storage.sql.exec("SELECT ts, camera_id, current, entries, exits FROM history WHERE deleted_at IS NULL AND ts >= ? AND ts <= ? ORDER BY ts", started, endedMs).toArray();
    // Average of the venue total over the service's minutes.
    const byMin = new Map();
    for (const r of rows) { const m = Math.floor(r.ts / 60000); const o = byMin.get(m) ?? new Map(); o.set(r.camera_id, r.current || 0); byMin.set(m, o); }
    const totals = [...byMin.values()].map((o) => [...o.values()].reduce((a, b) => a + b, 0));
    const svc = { id: live.id, name: live.name, started_at: live.started_at, ended_at: new Date(endedMs).toISOString(),
      peak: live.peak, peak_at: live.peak_at, average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : live.peak,
      rooms: live.rooms, status: "ask", face_data_deleted_at: new Date().toISOString() };
    const list = await this.get("services", []);
    list.unshift(svc);
    await this.ctx.storage.put("services", list.slice(0, 200));   // ~76 KB, inside the 128 KB limit
    await this.ctx.storage.delete("service_live");
    // Face matching data belongs to the service: wiped as soon as it ends.
    // Both the live copies and the written-down ones — the promise is that it
    // does not outlive the service, and a row in a table is not an exception
    // to that.
    this.faceCodes.clear();
    this.wipeFaces();
    this.register?.startService(null);
    await this.ctx.storage.delete("register");
    await this.ctx.storage.delete("rota_over_since");
  }

  /**
   * Start a service now, because an administrator said so.
   *
   * A service normally starts itself once SERVICE_START_PEOPLE people have been
   * in the room for SERVICE_START_MS. That is right for a Sunday and useless for
   * testing: on your own, a service can never start — and face matching only
   * runs during a service, so face matching could never be tried out. Hence
   * this.
   */
  /**
   * Start the arrival and departure figures again from zero, for a new session.
   *
   * Nothing is deleted. Every reading stays in the database exactly as it was,
   * and the whole day can still be looked at — all this does is remember each
   * camera's running total at this moment, so from here on the figures are
   * measured from zero. A second service in the afternoon therefore doesn't
   * inherit the morning's arrivals, and a morning's record is never lost to get
   * that.
   *
   * It also reaches the browsers doing the counting: each one sees this moment
   * in its next reply and puts its own tallies back to zero, keeping the people
   * it is already following so the "in the room now" figure doesn't blink.
   */
  async freshStart(now = Date.now(), forgetPeople = false) {
    const counters = await this.get("counters", {});
    const base = {};
    for (const [id, c] of Object.entries(counters)) base[id] = { entries: c.in || 0, exits: c.out || 0 };
    await this.ctx.storage.put("count_base", base);
    await this.ctx.storage.put("count_from", now);
    if (!forgetPeople) return { from: new Date(now).toISOString(), forgot: 0 };

    // "Start again from nobody."
    //
    // Asked for in so many words: "you know you can have the ability to
    // change the data back to 0 if ever you made an error like this". When
    // Kyro has got the register wrong — somebody counted four times, a coat
    // on a chair counted as a person — there has to be a way to say so and
    // begin again, without waiting for the service to end.
    //
    // Nothing is destroyed. The rows are marked deleted, exactly as a deleted
    // day is, and are really removed only after DELETED_KEPT_DAYS. Deciding
    // which of a church's own numbers to delete outright is not Kyro's to
    // make, and least of all quietly.
    const service = (await this.get("service_live", null))?.id ?? null;
    let forgot = 0;
    try {
      if (service) {
        forgot = this.ctx.storage.sql.exec(
          "SELECT COUNT(*) AS n FROM people WHERE deleted_at IS NULL AND service = ?", service).toArray()[0]?.n ?? 0;
        this.ctx.storage.sql.exec("UPDATE people SET deleted_at = ? WHERE deleted_at IS NULL AND service = ?", now, service);
      }
    } catch (e) {
      await this.wrong("Register of people", "Couldn't put the register of people back to nobody", e && e.message);
    }
    if (this.register) this.register.startService(service);
    await this.ctx.storage.delete("register");
    this.peopleSavedAt = 0;
    this.peopleSavedFor = null;
    this.movementCache = null;
    // What was put aside and when, so it is never a silent deletion.
    const log = await this.get("people_resets", []);
    log.unshift({ at: new Date(now).toISOString(), service, people: forgot });
    await this.ctx.storage.put("people_resets", log.slice(0, 50));
    return { from: new Date(now).toISOString(), forgot };
  }

  async startServiceNow() {
    const live = await this.get("service_live", null);
    if (live) return { live, already: true };
    const now = Date.now();
    const fresh = { id: `svc-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`, name: serviceName(now),
      started_at: new Date(now).toISOString(), peak: 0, peak_at: null, rooms: {}, started_by_hand: true };
    this.recentTotals = [];
    await this.ctx.storage.put("service_live", fresh);
    await this.ctx.storage.put("service_state", { busy_since: null, quiet_since: null });
    // A service started by hand is a new session: its arrivals and departures
    // start from zero, rather than carrying the last one's in with them.
    // (A service that starts by ITSELF doesn't do this — it is only noticed
    // once the room has filled, so starting fresh then would throw away the
    // arrivals that gave it away.)
    await this.freshStart(now);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 5 * 60_000);
    return { live: fresh, already: false };
  }

  async listServices() {
    const live = await this.get("service_live", null);
    const st = await this.get("service_state", {});
    return { live: live && { ...live, quiet_since: st.quiet_since ? new Date(st.quiet_since).toISOString() : null },
      services: await this.get("services", []), face_matching_now: !!live && (await this.privacy()).face_matching };
  }

  async keepService(id, user) {
    const list = await this.get("services", []);
    const s = list.find((x) => x.id === id);
    if (!s) return json({ error: "No such service" }, 404);
    s.status = "kept"; s.decided_by = clean(user, 60); s.decided_at = new Date().toISOString();
    await this.ctx.storage.put("services", list);
    return json(s);
  }

  async renameService(id, request) {
    const body = await request.json().catch(() => ({}));
    const list = await this.get("services", []);
    const live = await this.get("service_live", null);
    const name = clean(body.name, 80);
    if (!name) return json({ error: "Type a name" }, 400);
    if (live && live.id === id) { live.name = name; await this.ctx.storage.put("service_live", live); return json(live); }
    const s = list.find((x) => x.id === id);
    if (!s) return json({ error: "No such service" }, 404);
    s.name = name;
    await this.ctx.storage.put("services", list);
    return json(s);
  }

  /**
   * "Delete" removes the service from the list. The minute-by-minute counts
   * behind it are KEPT, so Analytics and the calendar still show that day —
   * deleting a service you didn't want recorded must never quietly wipe the
   * attendance figures. Pass ?counts=1 to remove those too (asked for
   * separately, with its own confirmation).
   */
  /**
   * Delete a service record.
   *
   * It goes to Recently deleted, whole, so it can be brought back for 30 days
   * and then goes for good — the same promise the day's counts already had.
   *
   * It used to keep only a note of WHAT was deleted: the name, the times, the
   * peak. That is enough to say "this was deleted" and not enough to undo it,
   * so a service deleted by mistake was gone the moment the button was
   * pressed, with a page that said it could be recovered for 30 days.
   */
  async deleteService(id, user, alsoCounts = false) {
    const list = await this.get("services", []);
    const s = list.find((x) => x.id === id);
    if (!s) return json({ error: "No such service" }, 404);
    if (alsoCounts) {
      this.ctx.storage.sql.exec("UPDATE history SET deleted_at = ? WHERE deleted_at IS NULL AND ts >= ? AND ts <= ?", Date.now(), Date.parse(s.started_at), Date.parse(s.ended_at));
      // Its register of people too — that is where attendance comes from.
      this.ctx.storage.sql.exec("UPDATE people SET deleted_at = ? WHERE deleted_at IS NULL AND service = ?", Date.now(), s.id);
    }
    await this.ctx.storage.put("services", list.filter((x) => x.id !== id));
    const log = await this.get("deleted_services", []);
    log.unshift({ ...s, counts_deleted: !!alsoCounts, deleted_by: clean(user, 60), deleted_at: new Date().toISOString() });
    await this.ctx.storage.put("deleted_services", this.tidyDeletedServices(log));
    return json({ deleted: true });
  }

  /** Gone for good after 30 days, like a deleted day's counts. */
  tidyDeletedServices(log, now = Date.now()) {
    const cutoff = now - DELETED_KEPT_DAYS * 86400_000;
    return log.filter((x) => Date.parse(x.deleted_at || "") > cutoff).slice(0, 200);
  }

  /** Put a deleted service back where it was. */
  async restoreService(id, user) {
    const log = await this.get("deleted_services", []);
    const was = log.find((x) => x.id === id);
    if (!was) return json({ error: "That service isn't in Recently deleted — it may have been more than 30 days ago" }, 404);
    const { counts_deleted, deleted_by, deleted_at, ...svc } = was;
    const list = await this.get("services", []);
    if (!list.some((x) => x.id === svc.id)) {
      list.unshift(svc);
      list.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
      await this.ctx.storage.put("services", list.slice(0, 200));
    }
    // The counts it took with it come back too, if they were deleted with it.
    if (counts_deleted && svc.started_at && svc.ended_at) {
      this.ctx.storage.sql.exec("UPDATE people SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND service = ?", id);
      this.ctx.storage.sql.exec("UPDATE history SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND ts >= ? AND ts <= ?",
        Date.parse(svc.started_at), Date.parse(svc.ended_at));
    }
    await this.ctx.storage.put("deleted_services", log.filter((x) => x.id !== id));
    return json({ restored: true, name: svc.name, counts_restored: !!counts_deleted });
  }

  /**
   * Gone now, rather than in thirty days.
   *
   * Recently deleted holds a service for thirty days so a mistake can be
   * undone. That is the right default and it is not always what is wanted: a
   * row that is certainly rubbish — a test, a session recorded by a camera
   * pointed at a desk — sits in the way for a month with a Bring it back
   * button nobody will ever press. Asked for in so many words: "mae the bin
   * icon button active so i can permanetly delte it so its out of the way if
   * ever i know for sure".
   *
   * This is the one place in Kyro that really destroys something, so it is
   * narrow on purpose. Only rows that were already marked deleted WITH this
   * service are removed; anything still live in the same stretch of time —
   * another service's readings, a day that was never deleted — is not
   * touched, however much its timestamps overlap.
   */
  async purgeService(id, user) {
    const log = await this.get("deleted_services", []);
    const was = log.find((x) => x.id === id);
    if (!was) return json({ error: "That service isn't in Recently deleted" }, 404);
    if (was.counts_deleted && was.started_at && was.ended_at) {
      try {
        // Only the rows this deletion marked. "deleted_at IS NOT NULL" is
        // what makes that safe: a live reading in the same minute stays.
        this.ctx.storage.sql.exec("DELETE FROM people WHERE deleted_at IS NOT NULL AND service = ?", id);
        this.ctx.storage.sql.exec("DELETE FROM history WHERE deleted_at IS NOT NULL AND ts >= ? AND ts <= ?",
          Date.parse(was.started_at), Date.parse(was.ended_at));
      } catch (e) {
        await this.wrong("Deleting a service",
          "Removed the service but couldn't remove the counts that went with it", e && e.message);
      }
    }
    await this.ctx.storage.put("deleted_services", log.filter((x) => x.id !== id));
    // Written down, because this one cannot be undone.
    const gone = await this.get("purged_services", []);
    gone.unshift({ id, name: was.name, started_at: was.started_at,
      purged_by: clean(user, 60), purged_at: new Date().toISOString(), counts_deleted: !!was.counts_deleted });
    await this.ctx.storage.put("purged_services", gone.slice(0, 200));
    return json({ purged: true, name: was.name });
  }

  /** The whole bin, in one go, for somebody looking at a page of test runs. */
  async purgeAllServices(user) {
    const log = await this.get("deleted_services", []);
    let n = 0;
    for (const s of [...log]) {
      const res = await this.purgeService(s.id, user);
      if (res.status === 200) n++;
    }
    return json({ purged: n });
  }

  /** An admin ends the service now (e.g. people are still chatting afterwards). */
  async endServiceNow(id) {
    const live = await this.get("service_live", null);
    if (!live || live.id !== id) return json({ error: "That service isn't running" }, 404);
    await this.endSession(Date.now());
    return json({ ended: true });
  }

  /**
   * The session is over — and everything that was about it goes back to zero.
   *
   * Ending a service used to put away the register and nothing else. The card
   * underneath kept the last session's "came in", "went out", "busiest arrival
   * time" and "half had arrived by", because those are measured from a
   * starting line that nobody had moved. So a session that ended at six
   * o'clock was still on the screen at seven, under the heading "this
   * session", describing a session that had finished.
   *
   * Asked for in so many words: "when I end my session or camera, this should
   * all be refreshed too".
   *
   * Nothing is deleted. finishService writes the service into the record, the
   * people rows keep the service they belonged to, and freshStart only moves
   * the starting line — the whole day can still be looked at. See freshStart.
   */
  async endSession(now = Date.now()) {
    const live = await this.get("service_live", null);
    if (live) await this.finishService(live, now);
    await this.ctx.storage.put("service_state", { busy_since: null, quiet_since: null });
    await this.freshStart(now, false);
    this.recentTotals = [];
    this.movementCache = null;
    return { ended: !!live };
  }

  // ── Face matching across cameras (off unless an admin switches it on) ─────

  async privacy() {
    return await this.get("privacy", { face_matching: false });
  }

  // ── How sure the AI must be before someone is counted ────────────────────
  // Lower = counts people it's less certain about (a soft or far-away picture,
  // e.g. through a wireless transmitter). Higher = only the obvious ones.

  /**
   * Kyro working out its own Counting sensitivity, and saying so.
   *
   * ── Why ────────────────────────────────────────────────────────────────
   *
   * The card tells somebody to count the room by hand, compare, and adjust.
   * Counting the room by hand is the job Kyro is for, so in practice nobody
   * does it and the setting never moves off Normal.
   *
   * Kyro already has a second opinion: a camera on the DOOR counts everyone
   * who walks through, one or two at a time, close and face-on, and keeps
   * its own record of different people. That is the nearest thing to a
   * ground truth in the building, and it is free.
   *
   * ── The trap, which is the whole difficulty ─────────────────────────────
   *
   * "the room camera cannot see the whole room."
   *
   * So a room camera seeing far fewer people than the door has let in is
   * NORMAL, and no sensitivity setting fixes it. Comparing the two numbers
   * and suggesting "Sensitive" whenever the room is lower would suggest it
   * for ever, in every church, and be wrong nearly every time.
   *
   * What tells the two apart is what the camera is THROWING AWAY. Each
   * camera reports what it would have counted with the bar lower and with
   * it higher — the same pictures, the same shape test, only the "sure
   * enough" line moved. Then:
   *
   *   - If the room is short of the door, and moving the bar down would
   *     close a real part of that gap, the bar is in the wrong place. There
   *     are people in shot that Kyro is nearly sure about and is dropping.
   *   - If moving the bar down would barely change the number, the people
   *     are not in shot at all. That is a camera pointed at part of a hall,
   *     and the honest answer is to say so rather than to offer a setting
   *     that cannot help.
   *
   * Nothing is changed automatically. This produces a sentence and a
   * figure; a person presses the button.
   */
  async suggestSensitivity(zones, doorPeople, now = Date.now()) {
    const nowSetting = (await this.counting()).count_confidence;
    const rooms = zones.filter((z) => z.location !== "entrance" && z.location !== "queue" && z.is_running);
    if (!rooms.length) return null;
    const live = await this.get("live", {});
    const bands = rooms.map((z) => {
      const l = live[z.camera_id] || {};
      return { name: z.zone_name || z.camera_name, now: z.current || 0,
               sensitive: l.at_sensitive || 0, careful: l.at_careful || 0 };
    });
    const seeingNow = bands.reduce((n, b) => n + b.now, 0);
    const wouldSee = bands.reduce((n, b) => n + b.sensitive, 0);
    const ifCareful = bands.reduce((n, b) => n + b.careful, 0);

    /**
     * Counting too many is the one Kyro can be sure of without a doorway:
     * more different people than the building has seats cannot be right,
     * whoever is counting. seatsInBuilding() is entered numbers only.
     */
    const seats = await this.seatsInBuilding();
    if (seats > 0 && seeingNow > seats && nowSetting < CAREFUL_CONFIDENCE) {
      return { setting: CAREFUL_CONFIDENCE, name: "Careful",
               why: `the cameras can see ${seeingNow} people in a building with ${seats} seats`,
               then: `Careful would make it ${ifCareful}` };
    }
    // Everything below needs the door's figure to compare against.
    if (!doorPeople) return null;
    const short = doorPeople - seeingNow;
    if (short <= SUGGEST_SHORT_BY) {
      // Counting MORE than walked in, by a margin a doorway cannot explain.
      if (-short > SUGGEST_SHORT_BY && nowSetting < CAREFUL_CONFIDENCE) {
        return { setting: CAREFUL_CONFIDENCE, name: "Careful",
                 why: `the cameras can see ${seeingNow} people but only ${doorPeople} have come through the door`,
                 then: `Careful would make it ${ifCareful}` };
      }
      return null;
    }
    if (nowSetting <= SENSITIVE_CONFIDENCE) return null;    // already as low as it goes
    const wouldGain = wouldSee - seeingNow;
    /**
     * …and only if moving the bar actually closes a worthwhile part of the
     * gap. Otherwise the people are not in shot, and a setting cannot help.
     */
    if (wouldGain < SUGGEST_GAIN_AT_LEAST || wouldGain < short * SUGGEST_GAIN_SHARE) {
      return { setting: null, name: null,
               why: `${bands.map((b) => b.name).join(" and ")} can see ${seeingNow} of the ${doorPeople} who have come in, and being less fussy would only find ${wouldGain} more`,
               then: "The rest are not in shot — this is what the camera is pointed at, not how sure it is" };
    }
    return { setting: SENSITIVE_CONFIDENCE, name: "Sensitive",
             why: `${doorPeople} have come through the door and the cameras can see ${seeingNow}, while dropping about ${wouldGain} more that they are nearly sure about`,
             then: `Sensitive would make it ${wouldSee}` };
  }

  /**
   * …and setting it, rather than asking.
   *
   * "its better for you to do it yourself, just let me know that you have
   * changed it, so you can remove it off my screen."
   *
   * So the control is gone and this does it. What that costs is the person
   * who would have looked at the two figures and said "no, the back of the
   * hall is simply out of shot" — so everything that made the suggestion
   * cautious matters more now, not less:
   *
   *   - it only acts where a setting WOULD help, never where the people are
   *     out of shot (see suggestSensitivity);
   *   - the same answer has to hold for three minutes, not one reading;
   *   - nothing moves twice inside twenty minutes;
   *   - every change is written down with the figures behind it, and is on
   *     the service card with one press to put it back.
   */
  async maybeSetSensitivity(hint, now = Date.now()) {
    const want = hint?.setting ?? null;
    const steady = this.sensitivitySince;
    // Not a suggestion, or a different one from a moment ago: start the
    // three minutes again.
    if (want === null) { this.sensitivitySince = null; this.sensitivityWant = null; return; }
    if (this.sensitivityWant !== want) {
      this.sensitivityWant = want;
      this.sensitivitySince = now;
      return;
    }
    if (!steady || now - steady < AUTO_SET_AFTER_MS) return;
    const was = (await this.counting()).count_confidence;
    if (was === want) { this.sensitivitySince = null; this.sensitivityWant = null; return; }
    const last = await this.get("sensitivity_set", null);
    if (last && now - last.at < AUTO_SET_GAP_MS) return;
    await this.ctx.storage.put("counting", { count_confidence: want });
    const note = { at: now, to: want, name: hint.name, from: was, why: hint.why, then: hint.then };
    await this.ctx.storage.put("sensitivity_set", note);
    /**
     * …and the whole list, because a setting that moves by itself has to be
     * answerable for afterwards. "Do not delete or rewrite historical
     * records to make the dashboard appear correct."
     */
    const log = await this.get("sensitivity_log", []);
    log.unshift(note);
    await this.ctx.storage.put("sensitivity_log", log.slice(0, 50));
    this.sensitivitySince = null;
    this.sensitivityWant = null;
    this.ctx.waitUntil(notifyCount(this.env, {
      kind: "sensitivity", zone: hint.name, count: 0,
    }).catch(() => {}));
  }

  async counting() {
    return await this.get("counting", { count_confidence: DEFAULT_COUNT_CONFIDENCE });
  }

  async setCounting(request) {
    const body = await request.json().catch(() => ({}));
    const v = Number(body.count_confidence);
    if (!Number.isFinite(v) || v < 0.1 || v > 0.6) return json({ error: "Pick one of the sensitivity settings" }, 400);
    const counting = { count_confidence: Math.round(v * 100) / 100 };
    await this.ctx.storage.put("counting", counting);
    return json(counting);
  }

  async setPrivacy(request, user) {
    const body = await request.json().catch(() => ({}));
    if (body.face_matching) {
      // Switching on needs both confirmations, recorded with who and when.
      //
      // There was briefly a larger gate here: a whole authorisation record
      // that had to be filled in and approved before this would work. The
      // church decided against it — the face data is temporary, the guide
      // explains what Kyro does with it, and the deletion is what actually
      // protects anybody. That decision belongs to the church as data
      // controller. What remains is what was here before and still stands:
      // off by default, two confirmations recorded against a name, running
      // only during a service, and deleted when it ends.
      if (body.dpia_confirmed !== true || body.notices_confirmed !== true)
        return json({ error: "Please confirm both: the data protection impact assessment, and the notices at the entrances" }, 400);
      await this.ctx.storage.put("privacy", { face_matching: true, dpia_confirmed: true, notices_confirmed: true,
        switched_on_by: clean(user, 60) || "an administrator", switched_on_at: new Date().toISOString() });
    } else {
      const prev = await this.privacy();
      await this.ctx.storage.put("privacy", { face_matching: false, switched_off_by: clean(user, 60) || "an administrator",
        switched_off_at: new Date().toISOString(), last_switched_on_by: prev.switched_on_by ?? null });
      this.faceCodes.clear();
      // Switched off means switched off: the face codes already written down
      // for this service go with it, not at the end of the service.
      this.wipeFaces();
    }
    return json(await this.privacy());
  }

  /** How many people are seen by two (or more) cameras right now, by face. */
  sameFaces(running) {
    const now = Date.now();
    const cams = [...this.faceCodes.entries()].filter(([id, f]) => running.has(id) && now - f.at < FACE_FRESH_MS && f.codes.length);
    for (const [id, f] of this.faceCodes) if (now - f.at > FACE_FRESH_MS) this.faceCodes.delete(id);
    if (cams.length < 2) return 0;
    // Union the faces that clearly match across different cameras (each face's best
    // match on the other camera, both ways, above the threshold).
    const nodes = cams.flatMap(([id, f]) => f.codes.map((c) => ({ cam: id, c })));
    const parent = nodes.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
    for (let a = 0; a < cams.length; a++) for (let b = a + 1; b < cams.length; b++) {
      const A = nodes.filter((n) => n.cam === cams[a][0]), B = nodes.filter((n) => n.cam === cams[b][0]);
      const best = (x, ys) => ys.reduce((m, y) => { const s = dot(x.c, y.c); return s > m.s ? { s, y } : m; }, { s: -1, y: null });
      for (const x of A) {
        const bx = best(x, B);
        if (bx.s < FACE_SAME || !bx.y) continue;
        if (best(bx.y, A).y !== x) continue;            // must be each other's best match
        parent[find(nodes.indexOf(x))] = find(nodes.indexOf(bx.y));
      }
    }
    const groups = new Map();
    nodes.forEach((_, i) => groups.set(find(i), (groups.get(find(i)) ?? 0) + 1));
    let extra = 0;
    for (const n of groups.values()) extra += n - 1;
    return extra;
  }

  // ── Seats the AI found by itself ─────────────────────────────────────────

  /** The camera computer found the seats itself: kept as the room's "Found by Kyro" layout. */
  async autoSeats(device, request) {
    const body = await request.json().catch(() => ({}));
    const key = clean(body.camera, 80);
    const camera_id = `${device.id}:${key}`;
    const cams = await this.get("cameras", {});
    if (!cams[camera_id]) return json({ error: "No such camera" }, 404);
    const seats = (Array.isArray(body.seats) ? body.seats : []).slice(0, MAX_SEATS).map(cleanSeatDef).filter((s) => s && s.seat_id);
    const list = await this.layoutsOf(camera_id);
    let auto = list.find((l) => l.source === "auto");
    const was = auto ? await this.seatsOf(camera_id, auto.id) : [];
    const keepReserved = new Map(was.filter((s) => s.reserved).map((s) => [s.seat_id, s.reserved_for]));
    for (const s of seats) if (keepReserved.has(s.seat_id)) { s.reserved = true; s.reserved_for = keepReserved.get(s.seat_id); }
    if (!auto) {
      auto = { id: Math.max(0, ...list.map((l) => l.id)) + 1, camera_id, name: "Found by Kyro", source: "auto",
        is_active: !list.some((l) => l.is_active), created_at: new Date().toISOString(), seat_count: 0, version: 0 };
      list.push(auto);
    }
    // Into the building first: one master seat per physical chair, and the row
    // and number come from there — where the stage is was answered by an
    // administrator, not assumed to be the top of the picture.
    await this.seatsIntoBuilding(camera_id, seats, Date.now());
    const b = await this.theBuilding();
    const master = new Map(b.seatsFor(camera_id).map((m) => [m.bbox.join(","), m]));
    for (const s of seats) {
      const m = master.get((s.bbox ?? []).join(","));
      if (!m) continue;
      s.row = m.row; s.number = m.number; s.section = m.section;
    }
    auto.seats = seats; auto.seat_count = seats.length; auto.version = (auto.version ?? 0) + 1;
    auto.stage = body.stage === "bottom" ? "bottom" : "top";
    await this.putLayouts(camera_id, list);
    if (auto.is_active) await this.syncCapacity(camera_id, seats.length);
    return json({ version: `${auto.id}.${auto.version}`, active: auto.is_active });
  }

  // ── Seat layouts and live seat states ─────────────────────────────────────
  // A layout is the seats drawn on a camera's picture (1280×720 coordinates, the
  // same as Kyro's seat engine). The camera computer works out each seat's state
  // (occupied / away / free, with the grace periods) and reports it every 2 s.

  async listLayouts(camera_id) {
    return (await this.layoutsOf(camera_id)).map(({ version, ...l }) => ({ ...l, seats: [], seat_count: l.seat_count ?? 0 }));
  }

  async createLayout(camera_id, request) {
    const cams = await this.get("cameras", {});
    if (!cams[camera_id]) return json({ error: "No such camera" }, 404);
    const body = await request.json().catch(() => ({}));
    const seen = new Set();
    const seats = (Array.isArray(body.seats) ? body.seats : []).slice(0, MAX_SEATS).map(cleanSeatDef).filter(Boolean)
      .map((s, i) => { let id = s.seat_id || `S${i + 1}`; while (seen.has(id)) id += "b"; seen.add(id); return { ...s, seat_id: id }; });
    if (!seats.length) return json({ error: "Add at least one seat" }, 400);
    if (seats.length > MAX_SEATS) return json({ error: `That's ${seats.length} seats. Kyro handles up to ${MAX_SEATS} per camera — use another camera for the rest of the room.` }, 400);
    const list = await this.layoutsOf(camera_id);
    const id = Math.max(0, ...list.map((l) => l.id)) + 1;
    // The first layout for a camera becomes its active one straight away.
    const layout = { id, camera_id, name: clean(body.name, 80) || `Layout ${id}`, is_active: !list.some((l) => l.is_active), created_at: new Date().toISOString(), seats, seat_count: seats.length, version: 1 };
    const keep = [...list, layout].slice(-5);
    for (const gone of [...list, layout].slice(0, -5)) await this.ctx.storage.delete(`lseats:${camera_id}:${gone.id}`);
    await this.putLayouts(camera_id, keep);
    if (layout.is_active) await this.syncCapacity(camera_id, seats.length);
    const { version, ...out } = layout;
    return json({ ...out, seat_count: seats.length });
  }

  async activateLayout(camera_id, id) {
    const list = await this.layoutsOf(camera_id);
    const l = list.find((x) => x.id === id);
    if (!l) return json({ error: "No such layout" }, 404);
    for (const x of list) x.is_active = x.id === id;
    l.version = (l.version ?? 0) + 1;
    await this.putLayouts(camera_id, list);
    await this.syncCapacity(camera_id, l.seat_count ?? 0);
    return json({ activated: true, seat_count: l.seat_count ?? 0 });
  }

  async deleteLayout(camera_id, id) {
    await this.putLayouts(camera_id, (await this.layoutsOf(camera_id)).filter((l) => l.id !== id));
    await this.ctx.storage.delete(`lseats:${camera_id}:${id}`);
    return json({ deleted: true });
  }

  /** Reserve / unreserve seats (e.g. "Pastor John"): kept in the active layout so every phone and the camera computer agree. */
  async reserveSeats(camera_id, request) {
    const body = await request.json().catch(() => ({}));
    const list = await this.layoutsOf(camera_id);
    const l = list.find((x) => x.is_active);
    if (!l) return json({ error: "This room has no seat layout yet" }, 404);
    l.seats = await this.seatsOf(camera_id, l.id);
    const ids = new Set((Array.isArray(body.seat_ids) ? body.seat_ids : []).map((s) => clean(s, 40)));
    for (const s of l.seats) {
      if (!ids.has(s.seat_id)) continue;
      s.reserved = !!body.reserved;
      s.reserved_for = body.reserved ? clean(body.reserved_for, 60) || null : null;
    }
    l.version = (l.version ?? 0) + 1;
    await this.putLayouts(camera_id, list);
    return json({ ok: true });
  }

  /**
   * The room's seat count follows its seat layout — but a count KYRO FOUND is
   * not the room's capacity until somebody says it is.
   *
   * ── What this was ──────────────────────────────────────────────────────
   *
   * "the system should not even guess that its 21 seats or 16 seats when
   * nothing was seen or shown ... dont assume anything".
   *
   * She never typed 21, or 16. The seat finder looked at her room, decided it
   * could see 21 seat-shaped things, and this wrote that straight into the
   * room's capacity — where it was indistinguishable from a number an
   * administrator had measured and entered. Everything downstream then
   * treated it as fact: "0 of 21 seats", "21 spaces left", a percentage full,
   * and the phone alert that fires when a room reaches 80% of it.
   *
   * A guess that cannot be told apart from a measurement is worse than no
   * guess, because every figure built on it inherits the confidence without
   * inheriting the doubt.
   *
   * So where the number came from is recorded with it. A found count is still
   * kept and still offered — "Kyro thinks it can see about 21 seats, is that
   * right?" — and it drives nothing until somebody answers.
   */
  async syncCapacity(camera_id, n, from = "found") {
    const cams = await this.get("cameras", {});
    const c = cams[camera_id];
    if (!c) return;
    // Never quietly overwrite a number a person entered with one Kyro found.
    if (from === "found" && c.capacity_from === "admin") return;
    c.zone_capacity = n;
    c.capacity_from = from;
    await this.ctx.storage.put("cameras", cams);
  }

  async boxSeats(device, url) {
    const key = clean(url.searchParams.get("camera"), 80);
    const cid = `${device.id}:${key}`;
    const l = (await this.layoutsOf(cid)).find((x) => x.is_active);
    return json(l ? { version: `${l.id}.${l.version ?? 0}`, seats: await this.seatsOf(cid, l.id) } : { version: null, seats: [] });
  }

  /** The seat map: the active layout with each seat's live state from the camera computer. */
  async seatStates(camera_id) {
    const meta = (await this.layoutsOf(camera_id)).find((x) => x.is_active);
    const l = await this.layoutWithSeats(camera_id, meta);
    if (!l) return { layout: null, seats: [], updated_at: null };
    const live = await this.get(`seat_live:${camera_id}`, null);
    const fresh = live && Date.now() - live.at < OFFLINE_AFTER_MS;
    const by = new Map(fresh ? live.seats.map((s) => [s[0], s]) : []);
    return {
      layout: { id: l.id, name: l.name }, updated_at: fresh ? new Date(live.at).toISOString() : null,
      seats: l.seats.map((s) => {
        const st = by.get(s.seat_id);
        return { ...s, state: s.reserved ? "reserved" : st ? st[1] : "unknown", confidence: st ? st[3] ?? 0 : 0,
          occupying_track_id: null, vacancy_seconds: st ? st[2] : 0, in_exclusion_zone: false };
      }),
    };
  }

  // ── "Find cameras" ────────────────────────────────────────────────────────
  // Only when an admin presses the button: each switched-on camera computer is
  // asked (on its next report, ~2 s) to look for cameras on its own network.
  // Adding one sends the login the admin typed to that computer, which asks the
  // camera for its video address; the login is deleted as soon as it answers.

  async jobsFor(device_id) {
    const jobs = await this.get("jobs", {});
    const now = Date.now();
    let changed = false;
    for (const [id, j] of Object.entries(jobs)) {
      if (now - j.created > JOB_TTL_MS) { delete jobs[id]; changed = true; }
    }
    if (changed) await this.ctx.storage.put("jobs", jobs);
    return Object.values(jobs).filter((j) => j.device_id === device_id && !j.done)
      .map(({ id, type, xaddr, ip, username, password }) => (type === "add" ? { id, type, xaddr, ip, username, password } : { id, type }));
  }

  async findCameras() {
    const devices = await this.get("devices", {});
    const on = Object.values(devices).filter((d) => d.id.startsWith("box-") && d.last_seen && Date.now() - Date.parse(d.last_seen) < OFFLINE_AFTER_MS);
    if (!on.length) return json({ error: "No camera computer is switched on. Kyro looks for cameras through the camera computer at church — switch it on and try again." }, 400);
    const jobs = await this.get("jobs", {});
    for (const [id, j] of Object.entries(jobs)) if (j.type === "find") delete jobs[id];
    for (const d of on) {
      const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
      jobs[id] = { id, type: "find", device_id: d.id, created: Date.now(), done: false };
    }
    await this.ctx.storage.put("jobs", jobs);
    await this.ctx.storage.put("found", {});
    return json({ asked: on.length });
  }

  async foundCameras() {
    const jobs = await this.get("jobs", {});
    const found = await this.get("found", {});
    const devices = await this.get("devices", {});
    const cams = await this.get("cameras", {});
    const known = new Set(Object.values(cams).filter((c) => c.kind === "network" && c.address)
      .map((c) => { try { return `${c.device_id}|${new URL(c.address).hostname}`; } catch { return ""; } }));
    const finds = Object.values(jobs).filter((j) => j.type === "find");
    const results = [];
    for (const [device_id, list] of Object.entries(found)) {
      for (const f of list) {
        results.push({ id: f.id, device_id, device_name: devices[device_id]?.name ?? "", ip: f.ip, name: f.name, model: f.model,
          added: known.has(`${device_id}|${f.ip}`) });
      }
    }
    return { searching: finds.some((j) => !j.done), searched: finds.length > 0 || Object.keys(found).length > 0, results };
  }

  async addFound(request) {
    const body = await request.json().catch(() => ({}));
    const found = await this.get("found", {});
    let hit = null, device_id = null;
    for (const [d, list] of Object.entries(found)) {
      const f = list.find((x) => x.id === body.id);
      if (f) { hit = f; device_id = d; }
    }
    if (!hit) return json({ error: "That camera isn't in the list any more — press Find cameras again" }, 404);
    const username = String(body.username ?? "").slice(0, 100), password = String(body.password ?? "").slice(0, 200);
    if (!username) return json({ error: "Type the camera's username" }, 400);
    const jobs = await this.get("jobs", {});
    const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
    jobs[id] = { id, type: "add", device_id, xaddr: hit.xaddr, ip: hit.ip, username, password, created: Date.now(), done: false,
      name: clean(body.name, 60) || hit.name || "Camera", zone_capacity: num(body.zone_capacity, 0, 100000) };
    await this.ctx.storage.put("jobs", jobs);
    return json({ job_id: id });
  }

  async addStatus(id) {
    const jobs = await this.get("jobs", {});
    const j = jobs[id];
    if (!j || j.type !== "add") return { done: true, ok: false, error: "That took too long — check the camera is switched on and try again" };
    return j.done ? { done: true, ok: j.ok, error: j.error ?? null, camera_id: j.camera_id ?? null } : { done: false };
  }

  async jobResult(device, request) {
    const body = await request.json().catch(() => ({}));
    const jobs = await this.get("jobs", {});
    const j = jobs[clean(body.id, 40)];
    if (!j || j.device_id !== device.id) return json({ ok: true });
    if (j.type === "find") {
      const found = await this.get("found", {});
      found[device.id] = (Array.isArray(body.found) ? body.found.slice(0, 50) : []).map((f) => {
        let xaddr = "";
        try { const u = new URL(String(f.xaddr ?? "")); if (u.protocol === "http:" || u.protocol === "https:") xaddr = u.href.slice(0, 300); } catch { /* skip */ }
        return { id: b64url(crypto.getRandomValues(new Uint8Array(6))), ip: clean(f.ip, 45), name: clean(f.name, 60), model: clean(f.model, 60), xaddr };
      }).filter((f) => f.ip && f.xaddr);
      await this.ctx.storage.put("found", found);
      j.done = true;
    } else if (j.type === "add") {
      // The login is never kept once the camera computer has answered.
      delete j.username; delete j.password; delete j.xaddr;
      j.done = true;
      let url = null;
      try { url = new URL(String(body.url ?? "")); } catch { /* not ok */ }
      if (body.ok && url && ["rtsp:", "rtsps:"].includes(url.protocol)) {
        j.ok = true;
        j.camera_id = await this.createNetworkCamera(device.id, String(body.url).slice(0, 500), { name: j.name, zone_name: j.name, zone_capacity: j.zone_capacity });
      } else {
        j.ok = false; j.error = clean(body.error, 200) || "Couldn't add that camera";
      }
    }
    jobs[j.id] = j;
    await this.ctx.storage.put("jobs", jobs);
    return json({ ok: true });
  }

  /** Network cameras are deleted; a USB camera is just switched off (it would reappear while plugged in). */
  async removeCamera(camera_id, permanent = false) {
    const cams = await this.get("cameras", {});
    const c = cams[camera_id];
    if (!c) return json({ error: "No such camera" }, 404);
    // Switching off only hides a plugged-in camera, because it would reappear.
    // Deleting really removes it: if it is still plugged in it comes back as a
    // new camera and Kyro asks whether to add it, which is what people expect.
    if (permanent || c.kind === "network") {
      delete cams[camera_id];
      const urls = await this.get("streams", {});
      delete urls[camera_id];
      await this.ctx.storage.put("streams", urls);
      await this.ctx.storage.delete(`layouts:${camera_id}`);
      await this.ctx.storage.delete(`seat_live:${camera_id}`);
      await this.ctx.storage.delete(`snap:${camera_id}`);
      // And its complaints. The camera is gone; a page of red about a camera
      // that no longer exists is noise nobody can act on, and there is now
      // nothing left that could ever report it working again.
      await this.forgetTrouble(c.name, c.label);
    } else {
      c.hidden = true;
      await this.ctx.storage.delete(`snap:${camera_id}`);
      await this.working(c.name);
      if (c.label) await this.working(c.label);
    }
    const live = await this.get("live", {});
    delete live[camera_id];
    await this.ctx.storage.put("live", live);
    await this.ctx.storage.put("cameras", cams);
    return json({ removed: true });
  }

  async updateCamera(camera_id, request) {
    const body = await request.json().catch(() => ({}));
    const cams = await this.get("cameras", {});
    const c = cams[camera_id];
    if (!c) return json({ error: "No such camera" }, 404);
    if (body.name !== undefined) c.name = clean(body.name, 60) || c.name;
    if (body.zone_name !== undefined) c.zone_name = clean(body.zone_name, 60) || c.zone_name;
    if (body.zone_capacity !== undefined) {
      c.zone_capacity = num(body.zone_capacity, 0, 100000);
      // Somebody typed it, so it stops being a guess — see syncCapacity.
      c.capacity_from = "admin";
    }
    if (body.zone_order !== undefined) c.zone_order = num(body.zone_order, 0, 1000);
    if (body.inward !== undefined) {
      c.inward = ["closer", "away", "left", "right"].includes(body.inward) ? body.inward : "closer";
    }
    if (body.location !== undefined) {
      // "entrance" is a camera on the door: it counts people coming in and
      // going out, and must never be added to how many are in the room.
      c.location = ["queue", "entrance"].includes(body.location) ? body.location : "indoor";
    }
    if (body.hidden !== undefined) { c.hidden = !!body.hidden; c.pending = false; }   // "Yes, add it" / "No"
    if (body.ignore_zones !== undefined) c.ignore_zones = cleanZones(body.ignore_zones);
    await this.ctx.storage.put("cameras", cams);
    return json({ ok: true });
  }
}
