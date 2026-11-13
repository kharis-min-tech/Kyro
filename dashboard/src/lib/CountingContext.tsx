"use client";

/**
 * Counting on this computer, from anywhere in Kyro.
 *
 * This used to live inside the Camera Mode page, so counting stopped the moment
 * you clicked AI Count or Seat Map — silently, with no warning. It is mounted
 * once at the top of the app instead (layout.tsx), alongside the AI questions
 * and the other app-wide pieces, so moving around Kyro no longer interrupts it.
 *
 * The one thing a browser genuinely can't do is count with nothing open: some
 * Kyro tab has to stay open somewhere. Any page will do.
 *
 * It owns its own hidden <video> elements, because a picture can only be taken
 * from a video element that is on the page.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  loadEngine, listCameras, openCamera, openCameraAnySize, cameraKey, grab, countPeople, savedDevice, sendSeats,
  COUNT_WIDTH, DOOR_WIDTH,
  sendReport, sendPicture, sendPersonPicture, cropOf, rememberCameraStep, holdFocus, refocus, type Engine, type CameraReport, type Zone, type WantedPicture,
} from "@/lib/cameraMode";
import { SteadyCount, COUNT_CONFIDENCE, outsideZones, notHeldBySomebody, looksLikeAPerson, type Person } from "@/lib/peopleDetector";
import { startLiveStream } from "@/lib/liveStream";
import { countOrder } from "@/lib/countOrder";
import { STILL_ENOUGH_MS, PersonTracker } from "@/lib/personTracker";
import { lookOf } from "@/lib/appearance";
import { PictureWatch } from "@/lib/pictureCheck";
import { SeatFinder, SEAT_W, SEAT_H } from "@/lib/seatFinder";
import { loadFaceEngine, type FaceEngine } from "@/lib/faceEngine";
import { loadOrt } from "@/lib/countEngine";
import { isEdgeLive, edgeTokenPayload } from "@/lib/edgeAuth";

const ON_KEY = "kyro_counting_on";          // keep counting after a reload
// An open camera with no picture for this long is worth telling someone about.
const NO_PICTURE_MS = 6_000;
// A camera missing this long is treated as gone for good, and only then are
// its figures let go.
const GONE_FOR_GOOD_MS = 5 * 60_000;
/** The furthest apart the "would tiles help?" check is ever asked. */
const TILE_CHECK_MOST = 120;
/**
 * How long one count may take before the camera is missing people.
 *
 * Judged against the JOB, which is the part that was missing. A doorway has
 * to see somebody TWICE to count them — twice is the only way to know which
 * way they were walking — and a person crosses a doorway in about a second.
 * Half a second a count is the floor; slower than that and the fast walkers
 * are simply not counted, which is invisible on the screen and looks exactly
 * like a quiet morning.
 *
 * A room camera has all service. It is only too slow when the number on the
 * screen visibly lags the room.
 *
 * "the count is very slow, people walk fast and you wouldnt even be able to
 * capture the person." She is right, and Kyro was judging both jobs by one
 * number — four seconds — which a doorway fails eight times over while
 * reporting itself perfectly healthy.
 */
const DOOR_SLOW_S = 0.5;
const ROOM_SLOW_S = 4;
const OFF_KEY = "kyro_camera_mode_off";     // cameras switched off on the website
const FRESH_KEY = "kyro_counts_fresh_from"; // the fresh start this browser has applied
const REPORT_EVERY_MS = 5_000;
const PICTURE_EVERY_MS = 20_000;
/**
 * How often faces are read, per camera.
 *
 * Four seconds is fine for a room, where people sit still and there is all
 * morning to recognise them. It is useless at a doorway, which is the one
 * place face matching is for: people cross in a second or two, so most of them
 * were never looked at once. "Switched on" and "never read anybody" at the
 * same time.
 */
const FACES_EVERY_MS = 4_000;
/**
 * How often each followed person's kept picture is refreshed.
 *
 * Drawn, not encoded — encoding is the expensive part and only happens if a
 * picture is actually asked for. Often enough that the one kept of somebody
 * is recent; rarely enough that a hall of a hundred costs almost nothing.
 */
/** How many times a camera is asked to focus again before Kyro stops asking
 *  and says so instead. */
const MOST_REFOCUS = 3;
/** …and how long between asks. A camera told to refocus every half minute is
 *  a camera that is never in focus. */
const REFOCUS_GAP_MS = 60_000;
const CROP_EVERY_MS = 8_000;
/** How many of those are kept per camera, oldest dropped first. */
/**
 * How many people's pictures are kept, per camera.
 *
 * ── Why sixty was the wrong number ──────────────────────────────────────────
 *
 * "you gave me questions like 'is this the same person' without even showing
 * me a picture of the two look alikes."
 *
 * A same-person question compares somebody in view NOW with somebody seen
 * earlier — and the earlier one is, by definition, the one who has gone. This
 * cache kept sixty, oldest evicted first. In a hall of a hundred and ten,
 * everybody in shot fills it within one pass, so the person who walked away
 * was always the first thing thrown out. The half of the question Kyro wanted
 * judged was deleted before it could be asked.
 *
 * Kept smaller each and more of them, for the same memory: a hundred and
 * fifty pictures at a hundred and sixty pixels across is about what sixty at
 * two hundred and forty was, and a hundred and sixty pixels is plenty to
 * recognise somebody by — which is the only thing these are for.
 */
const MOST_CROPS = 150;
/** How wide a kept picture is. See MOST_CROPS. */
const CROP_WIDTH = 160;
const DOOR_FACES_EVERY_MS = 1_200;
/**
 * And at most this many people each time.
 *
 * Reading a face costs two AI runs, so a doorway full of people cost twenty —
 * which is why it was throttled to once every four seconds in the first place.
 * Capping it keeps the cost the same whether two people or twenty are in the
 * picture, and lets it run often enough to be worth having.
 *
 * The biggest people in the picture are chosen: biggest means nearest, and
 * nearest is where a face is large enough to read at all.
 */
/**
 * How many faces are read in one go, at a minimum.
 *
 * Reading a face is the expensive part, so only the nearest few are read each
 * time — three was a cap chosen to be safe on the slowest computer.
 */
const FEWEST_FACES_AT_ONCE = 3;
/**
 * …and the most, when the computer is plainly keeping up.
 *
 * "make sure face recognition is on point."
 *
 * Three at a time is defensible on a laptop struggling to count at all, and
 * far too cautious everywhere else. In a hall of 114, three faces every four
 * seconds means any given person's face is read about once every two and a
 * half minutes — so face matching, the thing that actually tells two people
 * in dark coats apart, almost never gets a look at most of them.
 *
 * The cap now follows how fast this camera is actually counting. A computer
 * with headroom reads more faces; the moment counting slows, it drops back.
 * Counting is never traded for faces: a figure that lags behind the room is
 * worse than a figure that occasionally splits somebody.
 */
const MOST_FACES_AT_ONCE = 10;
/** Counting this often or better means there is room to read more faces. */
const FAST_ENOUGH_S = 1.2;
/** How often the seats Kyro has found are sent to the website. They don't move. */
const SEATS_EVERY_MS = 60_000;

/**
 * …and back again, for a face code the website is handing back.
 *
 * Only ever used on what this browser itself sent, when the website returns
 * a doorway's record after a reload — see door_known in worker/venue.js.
 */
function unpackFace(s: string): Float32Array | null {
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const out = new Float32Array(bytes.length / 2);
    for (let i = 0; i < out.length; i++) {
      // float16 → float32
      const h = view.getUint16(i * 2, true);
      const sign = h & 0x8000 ? -1 : 1, exp = (h >> 10) & 0x1f, mant = h & 0x3ff;
      out[i] = exp === 0 ? sign * mant * 2 ** -24
        : exp === 31 ? (mant ? NaN : sign * Infinity)
        : sign * (1 + mant / 1024) * 2 ** (exp - 15);
    }
    return out.length ? out : null;
  } catch { return null; }
}

/** A face code in the form the website expects: 128 half-size numbers, base64. */
function packFace(v: Float32Array): string {
  const buf = new ArrayBuffer(v.length * 2), view = new DataView(buf);
  for (let i = 0; i < v.length; i++) {
    // float32 → float16
    const f = new Float32Array([v[i]]);
    const bits = new Uint32Array(f.buffer)[0];
    const sign = (bits >>> 16) & 0x8000;
    const exp = ((bits >>> 23) & 0xff) - 127 + 15;
    const mant = (bits >>> 13) & 0x3ff;
    view.setUint16(i * 2, exp <= 0 ? sign : exp >= 31 ? sign | 0x7c00 : sign | (exp << 10) | mant, true);
  }
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

interface Cam {
  deviceId: string; key: string; label: string;
  stream: MediaStream | null; video: HTMLVideoElement | null; grabCanvas: HTMLCanvasElement;
  /** A recent picture of each person this camera is following, so somebody
   *  who has gone out of view can still be shown. See the report tick. */
  crops: Map<number, { at: number; crop: HTMLCanvasElement }>;
  steady: SteadyCount; count: number; peak: number; people: Person[]; rawPeople: Person[];
  countedAt: number; secondsPerCount: number; error: string | null; lastPicture: number;
  /** When this camera last gave a picture, or first failed to. A camera can be
   *  open and still send nothing — a black tile that never explains itself. */
  noPictureSince: number;
  /** How many times this camera has been asked for less, so we don't loop. */
  tries: number;
  /** When this camera dropped off the list of plugged-in cameras, if it has. */
  goneSince: number;
  // Splitting the picture into tiles costs five AI runs instead of one. It only
  // finds people too small to see in the whole picture — useless on a webcam
  // with someone close up, where it made each count five times slower. So try
  // the whole picture alone, and check now and then whether tiles would add
  // anyone; if they would, keep using them for this camera.
  needsTiles: boolean; sinceTileCheck: number;
  /**
   * How many times running the check has said tiles make no difference.
   *
   * The check costs SIX AI runs — five tiles and the whole picture — against
   * one for an ordinary count, and it ran every tenth count for ever. On a
   * camera where tiles have never once helped, that is a stall every ten
   * counts in exchange for an answer that has not changed all morning. So it
   * is asked less and less often, up to TILE_CHECK_MOST counts apart, and
   * the moment tiles DO help it goes back to checking often.
   */
  tilesNoHelp: number;
  /** Watching a doorway. It gets more turns, and never splits the picture. */
  isDoor: boolean;
  /** Watches for a black or frozen picture — see lib/pictureCheck.ts. */
  watch: PictureWatch;
  /** Finds this camera's seats by itself. Only ever for a camera on a room. */
  seatFinder: SeatFinder;
  /** When its seat list was last sent to the website. */
  seatsSentAt: number;
  /**
   * This camera's own track number → the person's number in the register.
   *
   * Comes back from the website with each report, because the website is the
   * only place that knows it: a camera's track number is a scratch number
   * for a box it is following, reissued whenever the detector loses somebody
   * and never the same thing twice. See `people` in worker/venue.js.
   */
  whoIs: Record<number, number>;
  /** Whether this camera's focus could be held still — see holdFocus. */
  focus?: "locked" | "already steady" | "cannot";
  /** Whether the website has already handed this camera back what it had
   *  counted before the browser restarted. See door_known. */
  gotRemembered?: boolean;
  /** How many times Kyro has asked it to focus again, and when last. */
  refocused?: number;
  refocusedAt?: number;
  tracker: PersonTracker;      // follows people between counts → arrived / left
  faces: string[] | null;      // face codes to send, when face matching is on
  facesAt: number;
}

export interface CamView {
  key: string;
  /** The browser's own id for this camera, so a page that has just scanned
   *  for cameras can tell which of them are already being counted. */
  deviceId: string;
  label: string; count: number; people: Person[]; rawPeople: Person[];
  /**
   * Everybody this camera is FOLLOWING, with its own number for each.
   *
   * Not the same as `people`, which is every detection in the last frame.
   * These are the ones confirmed and counted, and the number is the one the
   * website keys who-is-who on — so a preview drawn from these shows exactly
   * what the figure beside it is made of.
   */
  tracked: { track: number; box: [number, number, number, number]; person: number | null }[];
  /**
   * The size of the picture those boxes were measured in — NOT the camera's
   * own size.
   *
   * The AI is given a picture scaled down to COUNT_WIDTH, and every box it
   * returns is in that picture's coordinates. A camera sending 1920 wide is
   * counted at 1280, so a box drawn as though it were in the camera's own
   * picture lands two thirds of the way up and across: boxes floating on the
   * ceiling while the people underneath have none. Reported as "NOT
   * ACCURATE", with five boxes on the light fittings.
   */
  frameW: number; frameH: number;
  /** Watching a doorway, where speed is the difference between counting
   *  people and not. */
  isDoor: boolean;
  /** Too slow for what this camera is being asked to do — see DOOR_SLOW_S. */
  tooSlow: boolean;
  countedAt: number; secondsPerCount: number; error: string | null; streaming: boolean;
}

interface CountingValue {
  /** Allowed to count here at all (signed in as admin/operator on the live site, or Demo). */
  allowed: boolean;
  demo: boolean;
  phase: "idle" | "starting" | "running";
  step: string;
  progress: number;
  error: string | null;
  sendError: string | null;
  lastSent: number;
  engineInfo: string;
  /** The browser hasn't allowed the camera yet, so one click is unavoidable. */
  needsPermission: boolean;
  views: CamView[];
  total: number;
  /** How many of the cameras' sightings were one person seen twice, already
   *  taken off `total`. Shown so the figure is never a mystery. */
  seenTwice: number;
  /** Slowest seconds-per-count across the cameras — 0 before the first count. */
  secondsPerCount: number;
  start: () => Promise<void>;
  stop: () => void;
  /** The camera's live picture, for a preview. Straight from the camera, so no lag. */
  streamFor: (key: string) => MediaStream | null;
}

const Ctx = createContext<CountingValue | null>(null);
export const useCounting = () => useContext(Ctx);

function loadOff(): string[] { try { return JSON.parse(localStorage.getItem(OFF_KEY) ?? "[]"); } catch { return []; } }

export function CountingProvider({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [demo, setDemo] = useState(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "running">("idle");
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState(0);
  const [engineInfo, setEngineInfo] = useState("");
  const [views, setViews] = useState<CamView[]>([]);
  // True when the only thing stopping us is the browser's camera permission.
  const [needsPermission, setNeedsPermission] = useState(false);

  const demoRef = useRef(false);
  const engine = useRef<Engine | null>(null);
  const cams = useRef<Map<string, Cam>>(new Map());
  const running = useRef(false);
  const offRef = useRef<string[]>([]);
  const zonesRef = useRef<Record<string, Zone[]>>({});
  const countConfidenceRef = useRef<number>(COUNT_CONFIDENCE);
  // Face matching: off until an administrator switches it on and a service is
  // running (the website decides and tells us with each report).
  const faceOnRef = useRef(false);
  const faceEngine = useRef<FaceEngine | null>(null);
  /** Why faces can't be read here, if they can't. Told to the website, so the
   *  Face matching card can say so instead of sitting there saying "On". */
  const faceErr = useRef<string | null>(null);
  /**
   * Whatever has gone wrong in this browser, waiting to be sent to the
   * website with the next report.
   *
   * This is the half of Kyro nobody can see from the office: it runs on a
   * computer at the back of a hall, and until now its failures went to a
   * console log on that computer. A failure nobody can see is a failure
   * nobody fixes.
   */
  const problems = useRef<{ where: string; what: string; detail?: string }[]>([]);
  const say = useCallback((where: string, what: string, detail?: string) => {
    // One of each, so a camera failing on every count doesn't flood it.
    if (problems.current.some((p) => p.where === where && p.what === what)) return;
    problems.current.push({ where, what, detail });
    if (problems.current.length > 10) problems.current.shift();
  }, []);
  /** The service being recorded. When it changes, everybody is forgotten. */
  const serviceRef = useRef<string | null>(null);
  // The fresh start this browser has already applied, so a new session's zero
  // happens once and not on every report. Remembered across a reload: a
  // refresh must not undo a fresh start, nor re-apply an old one.
  const freshApplied = useRef<number>(0);
  useEffect(() => {
    // Read after mounting, never while rendering: this page is also built
    // ahead of time, where there is no browser and no localStorage.
    try { freshApplied.current = Number(localStorage.getItem(FRESH_KEY)) || 0; } catch { /* fine without it */ }
  }, []);
  /** How many of this computer's sightings are one person on two cameras, as
   *  the website's register works it out. 0 until it has told us. */
  const [seenTwice, setSeenTwice] = useState(0);
  /**
   * People Kyro wants a picture of, for "is this the same person?".
   *
   * The only place a picture of a particular person exists is here — the
   * video never leaves the computer the camera is plugged into. So the
   * website asks in its reply, and the next count sends what it can: the
   * crop round that one track, if that track is still in shot. The website
   * goes on asking for a minute, so a person who looked away for a second
   * still gets their picture taken.
   */
  const wantPics = useRef<WantedPicture[]>([]);
  const faceLoading = useRef(false);
  const wake = useRef<{ release(): Promise<void> } | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);

  /**
   * Where this camera's track numbers should carry on from.
   *
   * The website keys who-is-who on "camera#track" and keeps that link for
   * five minutes. A fresh tracker that starts at 1 — after a reload, a
   * reconnect, a tab reopened — hands the first person it sees a number that
   * is still remembered as somebody else, and they inherit that identity.
   *
   * Each tracker is given a block of its own, and the next block is written
   * down before it is used, so even a reload that never gets to save still
   * cannot hand out a number the last one did.
   */
  const nextTrackBase = (key: string): number => {
    const k = `kyro_track_base_${key}`;
    try {
      const base = Math.max(1, Number(localStorage.getItem(k)) || 1);
      localStorage.setItem(k, String(base + 10_000));
      return base;
    } catch { return 1; }
  };

  const refreshViews = useCallback(() => {
    setViews([...cams.current.values()].map((c) => ({
      key: c.key, deviceId: c.deviceId, label: c.label, count: c.count, people: c.people, rawPeople: c.rawPeople,
      // Everybody this camera is actually FOLLOWING, with its own number for
      // them. The preview used to draw the raw detections and label them by
      // their position in the list, which renumbered every frame and is not
      // an identity at all. These are the people being counted, and the
      // number is the one the website keys who-is-who on.
      // …and who the website says each of them IS. A track number changes
      // whenever the detector loses somebody for a moment; a person's number
      // in the register is theirs for the whole service. The picture shows
      // the second one, and shows nothing at all while the register has yet
      // to place somebody — a number that is about to change is worse than
      // no number, because no number cannot be mistaken for an identity.
      tracked: c.tracker.seenNow().map((x) => ({ track: x.track, box: x.box, person: c.whoIs[x.track] ?? null })),
      // The picture those boxes are in: the one the AI was given, scaled down
      // from the camera's. See frameW on CamView.
      frameW: c.grabCanvas.width || c.video?.videoWidth || 0,
      frameH: c.grabCanvas.height || c.video?.videoHeight || 0,
      isDoor: c.isDoor, tooSlow: tooSlow(c),
      countedAt: c.countedAt, secondsPerCount: c.secondsPerCount, error: c.error, streaming: !!c.stream,
    })));
  }, []);

  /** Open every camera plugged in, and pick up ones plugged in later. */
  const syncCameras = useCallback(async () => {
    const found = await listCameras();
    const seen = new Set<string>();
    for (const d of found) {
      const key = await cameraKey(d.deviceId);
      seen.add(key);
      let c = cams.current.get(key);
      if (!c) {
        c = {
          deviceId: d.deviceId, key, label: d.label || `Camera ${cams.current.size + 1}`,
          stream: null, video: null, grabCanvas: document.createElement("canvas"),
          steady: new SteadyCount(3), count: 0, peak: 0, people: [], rawPeople: [],
          countedAt: 0, secondsPerCount: 0, error: null, lastPicture: 0, noPictureSince: 0, tries: 0, goneSince: 0,
          needsTiles: true, sinceTileCheck: 0, tilesNoHelp: 0,
          isDoor: false, tracker: new PersonTracker(nextTrackBase(key)), faces: null, facesAt: 0,
          whoIs: {},
          watch: new PictureWatch(), seatFinder: new SeatFinder(key), seatsSentAt: 0,
          crops: new Map(),
        };
        // What this camera has already worked out about its seats, from last
        // time. Seats don't move; starting again every reload would mean
        // never finding them.
        try { c.seatFinder.load(localStorage.getItem(`kyro_seats_${key}`)); } catch { /* fine without it */ }
        cams.current.set(key, c);
      }
      const wanted = !offRef.current.includes(key);
      if (wanted && !c.stream) {
        try {
          // Every size, largest first — not one try at 1920x1080. A second
          // camera sharing a USB socket has no room for 1080p and the browser
          // simply refuses; 720p opens straight away. See openCameraAnySize.
          // A webcam refocuses whenever the picture changes, and a hall's
          // picture changes constantly — so it hunts, and every frame spent
          // hunting is a blurred frame with fewer people in it. Let it find
          // the room, then hold it there. Never waited on: counting starts
          // now, and the focus settles behind it. See holdFocus.
          c.stream = await openCameraAnySize(d.deviceId);
          holdFocus(c.stream).then((how) => { c.focus = how; }).catch(() => {});
          c.error = null;
          c.tries = 0;
          c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c!.stream = null; c!.error = "Unplugged"; refreshViews(); });
        } catch (e) {
          const name = e instanceof Error ? e.name : "";
          c.error = name === "NotReadableError"
            ? "This camera wouldn't open at any size. Either another program has it (Zoom, Teams, Photo Booth, FaceTime), or it is sharing a USB socket with another camera — give it a socket of its own."
            : name === "NotAllowedError" || name === "SecurityError"
            ? "The browser hasn't been allowed to use this camera. Click the camera icon in the address bar, choose Allow, then press Start counting."
            : name === "OverconstrainedError"
            ? "This camera wouldn't give a picture at any size Kyro can ask for. Try a different cable or USB socket."
            : `Kyro couldn't open this camera${name ? ` (${name})` : ""}. Unplug it, plug it back in, and press Start counting.`;
          // Say it out loud. A camera that never opens used to be left out of
          // the report altogether, so it appeared nowhere on the website at
          // all — which looks exactly like Kyro not noticing the camera.
          say(c.label, "Couldn't open this camera", c.error);
        }
      } else if (!wanted && c.stream) {
        c.stream.getTracks().forEach((t) => t.stop()); c.stream = null;
      }
      // Its own hidden video element, so a picture can be taken from any page.
      if (c.stream && holder.current) {
        if (!c.video) {
          const v = document.createElement("video");
          v.muted = true; v.playsInline = true; v.autoplay = true;
          v.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
          holder.current.appendChild(v);
          c.video = v;
        }
        if (c.video.srcObject !== c.stream) { c.video.srcObject = c.stream; c.video.play().catch(() => {}); }
      } else if (!c.stream && c.video) {
        c.video.remove(); c.video = null;
      }
    }
    // A camera that drops off the list keeps its figures for a while.
    //
    // It used to be forgotten the instant it wasn't listed, taking its count,
    // its peak and everything its tracker knew with it — so a loose plug, a
    // moment's hiccup in the browser's device list, or the camera being busy
    // for a second started the morning again from nothing. Close the camera,
    // by all means; don't throw away what it counted.
    for (const [key, c] of cams.current) {
      if (seen.has(key)) { c.goneSince = 0; continue; }
      if (!c.goneSince) {
        c.goneSince = Date.now();
        c.stream?.getTracks().forEach((t) => t.stop());
        c.stream = null;
        c.video?.remove();
        c.video = null;
        c.error = "Unplugged — its count is kept for a few minutes in case it comes back";
      } else if (Date.now() - c.goneSince > GONE_FOR_GOOD_MS) {
        cams.current.delete(key);
      }
    }
    refreshViews();
  }, [refreshViews, say]);

  /** Cameras take turns; always the newest picture. */
  const countLoop = useCallback(async () => {
    while (running.current) {
      let did = false;
      // A doorway camera gets more turns than a room one — see countOrder.
      for (const c of countOrder([...cams.current.values()])) {
        if (!running.current) break;
        if (!c.stream || !c.video || !engine.current) continue;
        // A doorway camera takes a smaller picture still: it uses the quick
        // AI, everyone it cares about is a step away, and looking twice as
        // often matters more there than anything else. See COUNT_WIDTH.
        const px = grab(c.video, c.grabCanvas, c.isDoor ? DOOR_WIDTH : COUNT_WIDTH);
        if (!px) {
          // The camera is open but has no picture to give. This used to be
          // skipped in silence, so the tile stayed black on "Starting…" with
          // nothing to act on. Say so once it has gone on long enough to mean
          // something.
          if (!c.noPictureSince) { c.noPictureSince = Date.now(); continue; }
          if (Date.now() - c.noPictureSince <= NO_PICTURE_MS) continue;
          if (c.tries < 3) {
            // Kyro asks every camera for 1920x1080, because more pixels means
            // people further away are still found. Some cameras accept that,
            // open happily, and then send nothing at all — two cameras sharing
            // one USB socket is the usual reason, since two 1080p pictures need
            // more of it than it has. Rather than tell someone to crawl behind
            // the desk, ask for less and try again. 720p counts people fine.
            c.tries++;
            c.noPictureSince = 0;
            try {
              c.stream?.getTracks().forEach((t) => t.stop());
              c.stream = await openCamera(c.deviceId, c.tries);
            holdFocus(c.stream).then((how) => { c.focus = how; }).catch(() => {});
              holdFocus(c.stream).then((how) => { c.focus = how; }).catch(() => {});
              c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c.stream = null; c.error = "Unplugged"; refreshViews(); });
              if (c.video) { c.video.srcObject = c.stream; c.video.play().catch(() => {}); }
              c.error = null;
            } catch {
              c.error = "This camera won't give a picture. Unplug it, plug it back in, and press Start counting.";
            }
            continue;
          }
          c.error = "This camera is open but sending no picture, at any size. Try its own USB socket on the computer rather than sharing one, or a different cable.";
          continue;
        }
        c.noPictureSince = 0;
        // Is this picture any use at all? A connected camera sending black, or
        // the same frame over and over, counts zero people and looks perfectly
        // healthy doing it.
        /**
         * A picture that has gone soft, said out loud.
         *
         * "HD Pro Webcam C920 — always loses focus." A camera hunting for
         * focus hands over blurred frames, and a blurred frame is one with
         * fewer people in it as far as the AI is concerned. It is not a
         * failure anybody can see from the numbers: the camera is live, the
         * count is simply lower than the room. Kyro tries to hold the focus
         * still when the camera allows it (see holdFocus) — and when it does
         * not, this is the half that notices.
         */
        /**
         * …and before saying anything, TRY TO FIX IT.
         *
         * A camera can settle on the wrong thing in the few seconds it is
         * given — somebody walking past the lens as counting starts — and
         * then be held there all service, which is a fault Kyro introduced
         * by holding it at all. Handing it back and letting it look again
         * costs a few seconds of hunting it was doing anyway.
         *
         * A few times only. A camera told to refocus every half minute is a
         * camera that is never in focus.
         */
        if (c.watch.soft && !c.watch.black && !c.watch.frozen && c.stream
            && (c.refocused ?? 0) < MOST_REFOCUS && Date.now() - (c.refocusedAt ?? 0) > REFOCUS_GAP_MS) {
          c.refocused = (c.refocused ?? 0) + 1;
          c.refocusedAt = Date.now();
          const stream = c.stream;
          refocus(stream).then((how) => {
            c.focus = how;
            // It is looking at the room again, so what "sharp" means here has
            // to be learned again — the old best was measured through a lens
            // focused somewhere else.
            if (c.stream === stream) c.watch.forgetSharpness();
          }).catch(() => {});
          say(c.label, "The picture went soft, so Kyro asked the camera to focus again.",
            `Attempt ${c.refocused} of ${MOST_REFOCUS}. If it keeps going soft, the lens may need wiping, or autofocus may need turning off in the camera's own software.`);
        }
        if (c.watch.soft && !c.watch.black && !c.watch.frozen) {
          say(c.label, "The picture has gone soft — the camera is hunting for focus, and blurred people are not counted.",
            c.focus === "locked"
              ? "Kyro has already asked it to hold focus. If it keeps happening, the lens may need cleaning, or the camera may be too close to what it is watching."
              : "This camera won't let Kyro hold its focus still. Turn autofocus off in the camera's own software if it has any, or move it so nothing passes close to the lens.");
        }
        if (c.watch.saw(px) && (c.watch.black || c.watch.frozen)) {
          say(c.label, c.watch.black
            ? "The picture is black. Kyro is asking the camera for a smaller picture — check the lens cap and the lighting too."
            : "The same picture over and over: the camera has stopped sending new frames, although it is still connected. Kyro is asking it for a smaller picture, which is usually a USB socket with too little bandwidth for 1920x1080.");
        }
        // A black picture, or the same frame over and over, is the same fault
        // as no picture wearing a disguise: ask the camera for less and try
        // again.
        //
        // FROZEN used to only be complained about. It is the commonest way a
        // HuddleCam fails — asked for 1080p on a USB socket that cannot carry
        // it, the camera does not refuse, it just stops sending new frames —
        // and the answer is the same one a black picture gets. Telling
        // somebody to unplug it and plug it back in, when Kyro could have
        // asked for a smaller picture instead, is work handed to a person
        // that the program should have done.
        if ((c.watch.black || c.watch.frozen) && c.tries < 3) {
          c.tries++;
          try {
            c.stream?.getTracks().forEach((t) => t.stop());
            c.stream = await openCamera(c.deviceId, c.tries);
            // So the next time counting starts, this camera is asked for the
            // size that works rather than going through this again.
            rememberCameraStep(c.deviceId, c.tries);
            c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c.stream = null; c.error = "Unplugged"; refreshViews(); });
            if (c.video) { c.video.srcObject = c.stream; c.video.play().catch(() => {}); }
            c.watch.reset();
            c.error = null;
          } catch {
            c.error = "This camera sends no usable picture at any size Kyro can ask for. Try its own USB socket rather than one shared with another camera.";
          }
          continue;
        }
        const t0 = performance.now();
        try {
          // Splitting the picture into tiles costs five AI runs instead of
          // one. At a doorway it is never worth it: people are a step from the
          // lens and fill the frame, so the whole picture finds them — and
          // five runs a count is exactly how a door camera ends up looking
          // once a second while people walk through it faster than that.
          // How many counts since the last check, before asking again. Ten
          // at first; further apart each time the answer comes back the
          // same. See tilesNoHelp.
          const apart = Math.min(TILE_CHECK_MOST, 10 * (1 + c.tilesNoHelp));
          const checking = !c.isDoor && ++c.sinceTileCheck >= apart;
          if (checking) c.sinceTileCheck = 0;
          const useTiles = !c.isDoor && (c.needsTiles || checking);
          // A doorway camera also uses the quicker AI: people cross a door in
          // a second, and looking twice as often matters far more there than
          // seeing someone at the back of a hall. See LocalEngine.fast.
          let people = await countPeople(engine.current, px, useTiles ? undefined : 1, c.isDoor);
          if (checking) {
            const whole = await countPeople(engine.current, px, 1);
            const sure = (list: Person[]) => list.filter((p) => p.score >= countConfidenceRef.current).length;
            c.needsTiles = sure(people) > sure(whole);
            // Ask less often while the answer keeps coming back the same,
            // and go straight back to asking often the moment it changes.
            c.tilesNoHelp = c.needsTiles ? 0 : c.tilesNoHelp + 1;
            if (!c.needsTiles) people = whole;
          }
          // Everything the AI noticed, before the "sure enough to count" cutoff,
          // so "nobody there" can be told apart from "seen but not sure".
          c.rawPeople = people;
          // Confident enough, not in a "don't count this" area, and not a
          // picture of people held up in front of the lens — see
          // notHeldBySomebody.
          // Shaped and scored like a person, not in a "don't count this"
          // area, and not a picture of people held up in front of the lens.
          c.people = notHeldBySomebody(
            outsideZones(
              looksLikeAPerson(people, px.height, countConfidenceRef.current),
              zonesRef.current[c.key], px.width, px.height));
          const codes = await faceCodes(c, px);
          // What each person looks like — the colour of what they're wearing,
          // their build, how tall they are in the picture. Costs nothing (no
          // AI, a sample of the pixels already in hand) and lets Kyro
          // recognise someone who stepped out of view, without reading faces.
          // Never stored, never sent: it lives on the track and dies with it.
          // Finding the seats: where people are now, and every few minutes a
          // look for empty chairs. Both are free of the counting — the chair
          // look is one extra AI run every five minutes, and only on a camera
          // watching a room, never on a doorway.
          if (!c.isDoor) {
            const boxes = c.people.map((p) => p.box as [number, number, number, number]);
            c.seatFinder.sawPeople(boxes, px.width, px.height, Date.now());
            if (c.seatFinder.wantsChairs(Date.now()) && engine.current.seating) {
              try {
                const chairs = await engine.current.seating(px);
                c.seatFinder.sawChairs(chairs.map((x) => x.box as [number, number, number, number]), px.width, px.height, Date.now());
              } catch (e) {
                // Finding seats must never stop counting people — but it must
                // not fail quietly either, or the seat map simply never
                // appears and nobody knows why.
                c.seatFinder.chairsAt = Date.now();
                say(c.label, "Couldn't look for chairs, so the seat map for this camera won't fill in",
                  e instanceof Error ? e.message : String(e));
              }
            }
            c.seatFinder.decide(Date.now());
          }
          const looks = c.people.map((p) => lookOf(px, p.box as [number, number, number, number]));
          c.tracker.update(c.people, Date.now(), codes ?? undefined, looks);
          c.count = c.steady.add(c.people.length);
          c.peak = Math.max(c.peak, c.count);
          c.countedAt = Date.now();
          c.secondsPerCount = (performance.now() - t0) / 1000;
          c.error = null;
        } catch (e) {
          c.error = `Counting problem: ${e instanceof Error ? e.message : e}`.slice(0, 120);
          say(c.label, "Counting failed on this camera", e instanceof Error ? e.message : String(e));
        }
        did = true;
      }
      refreshViews();
      // A breather so the page stays responsive, in proportion to the work just
      // done. A flat 350 ms wasted more time than a count takes once tiling is
      // off (about 200 ms), which showed as the number lagging behind the room.
      const slowest = Math.max(0, ...[...cams.current.values()].map((c) => c.secondsPerCount * 1000));
      // A breather so the page stays responsive, in proportion to the work
      // just done — but a tenth of a second at most when a camera is watching
      // a doorway. People cross a door in under a second; a third of a second
      // spent being polite is a third of the sightings there are to have.
      const door = [...cams.current.values()].some((c) => c.isDoor && c.stream);
      const rest = Math.max(door ? 20 : 50, slowest * (door ? 0.1 : 0.25));
      await new Promise((r) => setTimeout(r, did ? Math.min(door ? 100 : 350, rest) : 500));
    }
  }, [refreshViews]);

  /**
   * Is this camera too slow for what it is being asked to do?
   *
   * Nothing to say until it has actually counted something — a camera that
   * has never managed a count has a different problem, and this must not
   * shout over it. See DOOR_SLOW_S.
   */
  const tooSlow = useCallback((c: Cam) =>
    !!c.stream && !c.error && c.secondsPerCount > 0
    && c.secondsPerCount > (c.isDoor ? DOOR_SLOW_S : ROOM_SLOW_S), []);

  /** Face codes for this camera's people, every second or few while switched on. */
  const faceCodes = useCallback(async (c: Cam, px: ImageData): Promise<(Float32Array | null)[] | null> => {
    if (!faceOnRef.current) { c.faces = null; return null; }
    if (Date.now() - c.facesAt < (c.isDoor ? DOOR_FACES_EVERY_MS : FACES_EVERY_MS)) return null;
    if (!c.people.length) return null;
    if (!faceEngine.current) {
      if (faceLoading.current) return null;
      faceLoading.current = true;
      try {
        const ort = await loadOrt();
        faceEngine.current = await loadFaceEngine(ort);
        faceErr.current = null;
      } catch (e) {
        // Counting carries on without faces — that is the right call for the
        // count. It is the wrong call to say nothing: somebody switched face
        // matching on and is looking at a card that says it is running.
        faceErr.current = `The face AI wouldn't load on the counting computer: ${e instanceof Error ? e.message : e}`.slice(0, 160);
      }
      finally { faceLoading.current = false; }
      if (!faceEngine.current) return null;
    }
    c.facesAt = Date.now();
    // The nearest few only — see MOST_FACES_AT_ONCE. Their places are kept so
    // the codes come back lined up with the people they belong to; handing the
    // tracker a list in the wrong order would give people each other's faces.
    // How many to read this time: more when this camera is counting
    // comfortably, never fewer than the safe floor, and never so many that
    // the count starts lagging. secondsPerCount is measured, not assumed.
    const pace = c.secondsPerCount || 0;
    /**
     * A doorway has a much tighter idea of "fast enough".
     *
     * "make sure you get it quick and right because people move fast."
     *
     * Reading a face is an AI run, and it competes with counting for the
     * same few milliseconds. In a room that is a fair trade: the
     * congregation is sitting still, and a face is worth more than another
     * look at people who have not moved.
     *
     * At a door it is not. Somebody has to be seen TWICE to establish which
     * way they walked, and they cross in about a second — so the counting
     * has to manage a look every half second or the quick walkers are not
     * counted at all, which is invisible and looks like a quiet morning.
     * Judging a doorway against a room's idea of fast meant spending time on
     * faces that the counting could not spare, right where people move
     * fastest.
     *
     * So the door backs off to the fewest faces as soon as it is slower than
     * it can afford, rather than waiting until it is slower than a ROOM can
     * afford. See DOOR_SLOW_S.
     */
    const fastEnough = c.isDoor ? DOOR_SLOW_S : FAST_ENOUGH_S;
    const howMany = pace > 0 && pace <= fastEnough
      ? Math.round(FEWEST_FACES_AT_ONCE + (MOST_FACES_AT_ONCE - FEWEST_FACES_AT_ONCE)
          * Math.max(0, Math.min(1, (fastEnough - pace) / fastEnough)))
      : FEWEST_FACES_AT_ONCE;
    const nearest = c.people
      .map((p, i) => ({ i, size: p.box[3] - p.box[1] }))
      .sort((a, b) => b.size - a.size)
      .slice(0, Math.max(FEWEST_FACES_AT_ONCE, howMany))
      .map((x) => x.i);
    const read = await faceEngine.current.codesFor(px, nearest.map((i) => c.people[i].box));
    const codes: (Float32Array | null)[] = c.people.map(() => null);
    nearest.forEach((person, k) => { codes[person] = read[k] ?? null; });
    c.faces = codes.filter(Boolean).map((v) => packFace(v as Float32Array));
    return codes;
  }, []);

  const stop = useCallback(() => {
    running.current = false;
    // Say goodbye before letting go of the cameras.
    //
    // Stopping used to simply go quiet, and silence takes the website
    // forty-five seconds to notice. For those forty-five seconds Live Cameras
    // showed this camera's last picture, in colour, under a pulsing green
    // "Live" — a photograph of a moment that had passed, which is the most
    // convincing thing that can be on a screen. Now each camera reports that
    // it is off, and the website drops its picture there and then.
    const open = [...cams.current.values()].filter((c) => c.stream);
    if (open.length) {
      sendReport(open.map((c) => ({
        key: c.key, label: c.label, current: 0, peak: c.peak,
        entries: c.tracker.entries, exits: c.tracker.exits, people_seen: c.tracker.people,
        status: "offline" as const, error: null, fps: 0,
        width: c.video?.videoWidth ?? 0, height: c.video?.videoHeight ?? 0,
        counted_at: c.countedAt,
      }))).catch(() => { /* going off either way; silence costs 45 s, not the count */ });
    }
    for (const c of cams.current.values()) {
      c.stream?.getTracks().forEach((t) => t.stop()); c.stream = null;
      c.video?.remove(); c.video = null;
    }
    try { localStorage.setItem(ON_KEY, "0"); } catch {}
    wake.current?.release().catch(() => {});
    setPhase("idle"); refreshViews();
  }, [refreshViews]);

  const start = useCallback(async () => {
    if (running.current) return;
    setError(null); setPhase("starting"); setProgress(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use cameras. Use Chrome or Edge.");
      setStep("Asking to use the cameras…");
      const perm = await navigator.permissions?.query({ name: "camera" as PermissionName }).catch(() => null);
      if (perm?.state !== "granted") {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      }
      // Open the cameras while the AI loads, not after it.
      const cameras = syncCameras();
      if (!engine.current) {
        engine.current = await loadEngine((p, s) => { setProgress(Math.round(p)); setStep(s); });
        setEngineInfo(engine.current.kind === "accurate"
          ? "Most accurate AI, using this computer's graphics chip"
          : "Lighter AI — quick to start; Kyro upgrades by itself if this computer turns out fast enough");
      }
      await cameras;
      if (![...cams.current.values()].some((c) => c.stream)) {
        throw new Error("No camera found. Plug your camera into this computer, then press Start again. (The computer's own built-in camera is never used.)");
      }
      running.current = true;
      setNeedsPermission(false);
      try { localStorage.removeItem(ON_KEY); } catch {}
      setPhase("running");
      countLoop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/NotAllowed|Permission/i.test(`${(e as Error)?.name} ${msg}`)
        ? "The browser wasn't allowed to use the camera. Click the camera icon in the address bar, choose Allow, then press Start."
        : msg);
      setPhase("idle");
    }
  }, [syncCameras, countLoop]);

  // Who may count here, and pick up again after a reload.
  useEffect(() => {
    const role = edgeTokenPayload()?.role;
    const isDemo = localStorage.getItem("kyro_mode") !== "live";
    demoRef.current = isDemo; setDemo(isDemo);
    const may = isDemo || (isEdgeLive() && (role === "admin" || role === "operator"));
    setAllowed(may);
    offRef.current = loadOff();
    if (!may) return;
    // Count whenever we can, without being asked. The only reasons not to:
    // someone pressed Stop, or the browser hasn't been allowed the camera yet
    // (a page can't switch a camera on without a click — that's the browser's
    // rule, not ours, and the card says so).
    let stopped = false;
    try { stopped = localStorage.getItem(ON_KEY) === "0"; } catch {}
    if (stopped) return;
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: "camera" as PermissionName });
        if (p && p.state !== "granted") { setNeedsPermission(true); return; }
        const cams = await listCameras();
        if (cams.length) start();
      } catch { /* leave it to the Start button */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send counts and pictures to the website.
  useEffect(() => {
    if (phase !== "running" || demoRef.current) return;
    const tick = async () => {
      // Every camera this browser knows about, INCLUDING ones that wouldn't
      // open. A camera left out of the report appears nowhere on the website,
      // so a camera Kyro can see but cannot use was indistinguishable from a
      // camera Kyro never noticed — and the one thing the operator needed was
      // the reason. It reports with its reason and no figures.
      const list = [...cams.current.values()];

      // Crops Kyro has asked for, sent before the report is built and kept
      // well away from it.
      //
      // A routine report carries numbers and nothing else — eight for an
      // appearance, and a face code only while face matching is on. That is
      // guarded by a test, and the guard reads the report-building code, so
      // anything to do with a picture stays out of it. A crop only ever
      // leaves this computer because somebody is being asked to look at it,
      // one person at a time, by name of question. See sendPersonPicture.
      /**
       * A recent picture of everybody this camera is following.
       *
       * ── Why it has to be kept rather than taken on demand ──────────────
       *
       * "when you show me the question of the same person, you didnt show me
       * a picture of the person."
       *
       * A question compares somebody in front of the camera NOW with
       * somebody it saw EARLIER — and the earlier one has, by definition,
       * gone out of view. That is the whole reason Kyro is unsure. Asking
       * for their picture at the moment the question is written asks for a
       * picture of somebody who is not there, so the second half of every
       * question arrived blank.
       *
       * So a small crop of each person is kept as it is taken, and the
       * picture of somebody who left is the last one of them. Drawn into a
       * canvas and not encoded — encoding is the expensive part, and it only
       * happens if a picture is actually asked for.
       */
      const now = Date.now();
      for (const c of list) {
        if (!c.grabCanvas || !c.stream) continue;
        const seen = c.tracker.seenNow();
        for (const x of seen) {
          const had = c.crops.get(x.track);
          if (had && now - had.at < CROP_EVERY_MS) continue;
          const crop = cropOf(c.grabCanvas, x.box as [number, number, number, number], CROP_WIDTH);
          if (crop) c.crops.set(x.track, { at: now, crop });
        }
        // Oldest first, so the people most recently in shot are the ones
        // kept — and a morning's worth of tracks never piles up. The people
        // Kyro has actually asked for are not in here to be lost: a wanted
        // picture is sent on the same tick it is asked for, below.
        if (c.crops.size > MOST_CROPS) {
          const old = [...c.crops.entries()].sort((a, b) => a[1].at - b[1].at);
          for (const [k] of old.slice(0, c.crops.size - MOST_CROPS)) c.crops.delete(k);
        }
      }

      // Crops Kyro has asked for, sent before the report is built and kept
      // well away from it.
      //
      // A routine report carries numbers and nothing else — eight for an
      // appearance, and a face code only while face matching is on. That is
      // guarded by a test, and the guard reads the report-building code, so
      // anything to do with a picture stays out of it. A crop only ever
      // leaves this computer because somebody is being asked to look at it,
      // one person at a time, by name of question.
      if (wantPics.current.length) {
        for (const c of list) {
          const mine = wantPics.current.filter((w) => w.key === c.key);
          if (!mine.length) continue;
          for (const want of mine) {
            /**
             * A seat is cropped where it is, now — not from the kept
             * pictures, which are of people.
             *
             * A chair does not move, so there is no need to have kept one:
             * the place it is in is the place it will still be in. Its box
             * is in the seat finder's own space, so it is scaled back to
             * the picture the crop is taken from.
             */
            if (want.seat) {
              // Any seat, not only an unsure one: "is this the same chair?"
              // asks about two chairs Kyro is perfectly sure are chairs. It
              // is which ONE they are that it cannot settle.
              const pl = c.seatFinder.places.find((x) => x.id === want.seat);
              if (!pl || !c.grabCanvas.width) continue;
              const sx = c.grabCanvas.width / SEAT_W, sy = c.grabCanvas.height / SEAT_H;
              const shot = cropOf(c.grabCanvas,
                [pl.box[0] * sx, pl.box[1] * sy, pl.box[2] * sx, pl.box[3] * sy], CROP_WIDTH);
              if (!shot) continue;
              sendPersonPicture(want.id, want.side, shot).catch(() => {});
              wantPics.current = wantPics.current.filter((w) => !(w.id === want.id && w.side === want.side));
              continue;
            }
            const kept = c.crops.get(want.track);
            if (!kept) continue;     // never had a picture of them; the website asks again
            sendPersonPicture(want.id, want.side, kept.crop)
              .catch(() => { /* a missing picture only means the question isn't asked */ });
            wantPics.current = wantPics.current.filter((w) => !(w.id === want.id && w.side === want.side));
          }
        }
      }

      const reports: CameraReport[] = list.map((c) => {
        if (!c.stream || !c.video) return {
          key: c.key, label: c.label, current: 0, peak: c.peak,
          entries: c.tracker.entries, exits: c.tracker.exits, people_seen: c.tracker.people,
          status: "error", error: c.error ?? "This camera isn't open yet",
          fps: 0, width: 0, height: 0, no_picture: true, counted_at: c.countedAt,
        };
        // Who is in which seat, as this camera sees it. Worked out once and
        // used for both the seat states and the register, so the two cannot
        // disagree about where somebody is sitting.
        const following = c.tracker.seenNow();
        // The picture the boxes were measured in — the one the AI was given,
        // which is scaled down from the camera's own. Using the camera's size
        // here put every seat and every reported position two thirds of the
        // way up and across the picture. See frameW on CamView.
        const frameW = c.grabCanvas.width || c.video?.videoWidth || 1280;
        const frameH = c.grabCanvas.height || c.video?.videoHeight || 720;
        const seatOf = c.isDoor ? [] : c.seatFinder.whoIsWhere(
          following.map((x) => x.box as [number, number, number, number]),
          frameW, frameH).seatOfPerson;
        return ({
        key: c.key, label: c.label, current: c.count, peak: c.peak,
        entries: c.tracker.entries, exits: c.tracker.exits,
        // Different people, counted once each — see PersonTracker.people.
        people_seen: c.tracker.people,
        // How long people stay in this camera's view, in seconds. A doorway
        // sees somebody for a few seconds and a hall for an hour, so this is
        // how the website can tell a camera that is SET as a room but is
        // really pointed at a door — which invents a new person for everyone
        // who walks past it. See typicalLifeS in personTracker.ts.
        life_s: c.tracker.typicalLifeS || undefined,
        // Which of this camera's seats are taken. A seat id and a person id
        // are different things: somebody who sits in five chairs during a
        // service is five seats and one person in the attendance register.
        /**
         * Chairs Kyro has found and is NOT sure about.
         *
         * "kyro should be able to recognise what a chair is though and when
         * people are sitting down and where a chair is, thats why it should
         * ask questions, which has not been doing completely."
         *
         * It does recognise them — chairs, benches and sofas come out of the
         * same AI run that finds people, costing nothing extra — and it
         * already marks the ones it cannot settle: somebody standing very
         * upright, or a seat nowhere near any other seat. The note beside
         * that code says they are "for an administrator to confirm or
         * reject", and on a camera computer a photograph was sent and the
         * question asked.
         *
         * In Camera Mode nothing ever asked. The uncertain seats sat in the
         * seat map waiting to be noticed, which is not the same as being
         * asked about, and is why she has never once been shown one.
         *
         * A few at a time, so a hall full of chairs cannot turn into a hall
         * full of questions.
         */
        ...(c.isDoor ? {} : { seat_asks: c.seatFinder.uncertain().slice(0, 4).map((pl) => ({
          id: pl.id,
          // In the seat finder's own space; the crop converts it back when a
          // picture is asked for. See SEAT_W.
          b: pl.box.map((v) => Math.round(v)),
        })) }),
        ...(c.isDoor ? {} : { seats: c.seatFinder.occupancy(
          c.people.map((p) => p.box as [number, number, number, number]),
          frameW, frameH, Date.now()) }),
        // Everyone this camera is following, for the website's register of
        // people. A look is eight small numbers; a face only travels while
        // face matching is switched on, and is a list of numbers either way —
        // never a picture. See worker/identity.js.
        seen: following.slice(0, 40).map((x, i) => ({
          t: x.track,
          // Where in the picture they are, as four fractions of the frame.
          // Fractions rather than pixels so it means the same thing on any
          // camera. The website uses it to recognise somebody the detector
          // lost for a report or two as the person who was sitting in that
          // spot, instead of writing them down as a new arrival — which in a
          // full hall is where a register goes wrong. See SPOT_SAME in
          // worker/identity.js.
          b: [x.box[0] / frameW, x.box[1] / frameH, x.box[2] / frameW, x.box[3] / frameH]
            .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000),
          // Which seat this person is in, if any. Context for the register,
          // never proof of who they are — see SEAT_HELPS in identity.js.
          s: seatOf[i] ?? null,
          l: x.look ? [x.look.top[0], x.look.top[1], x.look.top[2],
                       x.look.bottom[0], x.look.bottom[1], x.look.bottom[2],
                       x.look.shape, x.look.height].map((v) => Math.round(v * 1000) / 1000) : null,
          f: faceOnRef.current && x.face ? packFace(x.face) : null,
          // How long this box has not moved at all. A seated human being is
          // never still; a pillow, a coat over a chair or a poster is. Sent
          // so the website can ASK about one — never so it can decide. See
          // STILL_ENOUGH_MS in personTracker.ts.
          q: x.stillFor >= STILL_ENOUGH_MS ? Math.round(x.stillFor / 1000) : undefined,
        })),
        /**
         * People this doorway has newly learned, to be kept on the website.
         *
         * "if it reloads, does it mean face recognition will not know the
         * previous?" — the faces are safe, but THIS list was not: the door's
         * own record of who it has already counted was built fresh on every
         * page load, so the usher in and out all morning was counted again
         * after each one.
         *
         * Only what is new since the last report, so it is a handful of
         * people rather than the morning, and only from a doorway, which is
         * the only camera that keeps one. A face travels as numbers, the
         * same as everywhere else here, and only while face matching is on.
         */
        ...(c.isDoor ? { remembered: c.tracker.takeNewlyRemembered().slice(0, 25).map((k) => ({
          l: k.look ? [k.look.top[0], k.look.top[1], k.look.top[2],
                       k.look.bottom[0], k.look.bottom[1], k.look.bottom[2],
                       k.look.shape, k.look.height].map((v) => Math.round(v * 1000) / 1000) : null,
          f: faceOnRef.current && k.face ? packFace(k.face) : null,
          i: k.countedIn ? 1 : 0, o: k.countedOut ? 1 : 0, u: k.uniqued ? 1 : 0, at: k.at,
        })) } : {}),
        // Every decision this camera made at the door since the last report,
        // so the website can show what was counted and what wasn't.
        events: c.tracker.drainEvents(),
        ...(c.faces?.length ? { faces: c.faces, faces_age_s: (Date.now() - c.facesAt) / 1000 } : {}),
        status: c.error || Date.now() - c.countedAt > 60_000 ? "error" : "online",
        error: c.error ?? (c.countedAt ? null : "Starting…"),
        fps: c.secondsPerCount ? +(1 / c.secondsPerCount).toFixed(1) : 0,
        // Honest about what the picture is, separately from whether the
        // camera is connected. Connected is not working.
        black: c.watch.black, frozen: c.watch.frozen,
        no_picture: !!c.noPictureSince && Date.now() - c.noPictureSince > NO_PICTURE_MS,
        counted_at: c.countedAt,
        width: c.video?.videoWidth ?? 0, height: c.video?.videoHeight ?? 0,
      });
      });
      // Which cameras are fine right now. A problem on the "Is Kyro working?"
      // page is only ever cleared by the thing that failed working again, and
      // nothing was ever saying that a camera had come right — so one black
      // frame at any point left a red line that no amount of fixing could
      // shift. Open, a changing non-black picture, counting: that is working.
      const well = list
        .filter((c) => c.stream && !c.error && !c.watch.black && !c.watch.frozen
          && !!c.countedAt && Date.now() - c.countedAt < 60_000
          && !tooSlow(c))
        .map((c) => c.label);
      /**
       * Too slow to do its job, said out loud.
       *
       * A camera counting once every three seconds is open, healthy, sending
       * a perfect picture and missing most of a congregation walking through
       * a door — and every indicator Kyro had said it was fine. This is the
       * failure that looks exactly like a quiet morning.
       *
       * Reported like any other fault, so it clears itself when the computer
       * catches up (see `well` above) rather than sticking.
       */
      for (const c of list) {
        if (!tooSlow(c)) continue;
        say(c.label, c.isDoor
          ? `Counting once every ${c.secondsPerCount.toFixed(1)}s — too slow for a doorway. Somebody has to be seen twice to be counted, and people cross a door in about a second, so the quick walkers are being missed.`
          : `Counting once every ${c.secondsPerCount.toFixed(1)}s, so the number lags behind the room.`,
          "Close other tabs and programs on this computer, or count on fewer cameras from it.");
      }
      try {
        const { disabled, zones, countConfidence, faceMatching, doorways, countFrom, service, doorMode, seenTwice: twice, wantPictures, people, remembered, answers } =
          await sendReport(reports, { error: faceErr.current, ready: !!faceEngine.current }, problems.current, well);
        // Merged rather than replaced: the website keeps asking until the
        // pictures arrive, and one that is already on its way must not be
        // dropped because the next reply happened to leave it out.
        for (const w of wantPictures) {
          if (!wantPics.current.some((x) => x.id === w.id && x.side === w.side)) wantPics.current.push(w);
        }
        /**
         * Answers coming back the other way.
         *
         * A seat question is settled on the website, and the camera is the
         * only thing that knows where its seats are — so the answer has to
         * travel back. Without this the question could be answered all day
         * and the seat map would never change, which is worse than not
         * asking.
         */
        for (const ans of answers ?? []) {
          if (ans.kind !== "is_this_a_seat" || !ans.seat) continue;
          const cam = [...cams.current.values()].find((x) => x.key === ans.key);
          if (!cam) continue;
          if (/yes|seat/i.test(String(ans.answer))) cam.seatFinder.confirm(ans.seat);
          else cam.seatFinder.reject(ans.seat);
        }
        wantPics.current = wantPics.current.slice(-24);
        setSeenTwice(twice);
        // Who each sighting turned out to be. Kept per camera so the picture
        // can show the number Kyro counts somebody as — see whoIs on Cam.
        for (const c of cams.current.values()) c.whoIs = people[c.key] ?? {};
        /**
         * The doorway's record of who it had already counted, back from the
         * website after this browser restarted.
         *
         * "if it reloads, does it mean face recognition will not know the
         * previous?" The faces were always safe; this was not, and it is why
         * the usher who is in and out all morning was counted again after
         * every reload.
         *
         * Only ever arrives at a restart — the website sends it at that one
         * moment — so there is nothing to guard against here beyond not
         * putting the same list in twice.
         */
        for (const c of cams.current.values()) {
          const back = remembered[c.key];
          if (!back?.length || c.gotRemembered) continue;
          c.gotRemembered = true;
          c.tracker.restoreRemembered(back.map((k) => ({
            look: k.l && k.l.length === 8
              ? { top: [k.l[0], k.l[1], k.l[2]] as [number, number, number],
                  bottom: [k.l[3], k.l[4], k.l[5]] as [number, number, number],
                  shape: k.l[6], height: k.l[7] }
              : null,
            face: k.f ? unpackFace(k.f) : null,
            countedIn: !!k.i, countedOut: !!k.o, uniqued: !!k.u, at: Number(k.at) || Date.now(),
          })));
        }
        problems.current = [];
        // A different service, or none: forget everybody seen in the last one.
        // People are remembered only for as long as one service runs — see
        // PersonTracker.forgetPeople.
        if (service !== serviceRef.current) {
          serviceRef.current = service;
          for (const c of cams.current.values()) c.tracker.forgetPeople();
        }
        // A new session: start the arrivals and departures again from zero.
        //
        // The instruction comes back from the website, so "Start fresh" can be
        // pressed on a phone at the door and still reach the computer in the
        // office that is doing the counting. The people being followed are
        // kept, so "here now" doesn't blink and nobody in the room is counted
        // as having just walked in.
        if (countFrom > freshApplied.current) {
          freshApplied.current = countFrom;
          try { localStorage.setItem(FRESH_KEY, String(countFrom)); } catch { /* fine without it */ }
          for (const c of cams.current.values()) { c.tracker.resetCounts(); c.peak = c.count; }
        }
        // A camera on a door counts people by which way they walked, not by
        // appearing and disappearing — everyone at a door does both.
        for (const c of cams.current.values()) {
          const inward = doorways[c.key] ?? null;
          c.isDoor = !!inward;
          // doorMode: an operator has said everybody crossing is arriving or
          // leaving — at the end of a service that is a fact, not a guess.
          c.tracker.watchesDoorway(inward, inward ? doorMode : null);
        }
        zonesRef.current = zones;
        if (countConfidence !== undefined) countConfidenceRef.current = countConfidence;
        faceOnRef.current = !!faceMatching;
        if (!faceMatching) for (const c of cams.current.values()) c.faces = null;   // nothing kept when off
        setLastSent(Date.now()); setSendError(null);
        const newlyOff = disabled.filter((k) => !offRef.current.includes(k));
        if (newlyOff.length) {
          offRef.current = [...offRef.current, ...newlyOff];
          try { localStorage.setItem(OFF_KEY, JSON.stringify(offRef.current)); } catch {}
          await syncCameras();
        }
        // The seat list itself, when it has changed and not too often. The
        // same endpoint the installed camera computer uses, so the website
        // needs no new idea of where seats come from.
        for (const c of list) {
          if (!c.stream || c.isDoor || Date.now() - c.seatsSentAt < SEATS_EVERY_MS) continue;
          const seats = c.seatFinder.seats();
          if (!seats.length) continue;
          c.seatsSentAt = Date.now();
          try { localStorage.setItem(`kyro_seats_${c.key}`, c.seatFinder.save()); } catch { /* fine without it */ }
          sendSeats(c.key, seats, c.seatFinder.stage).catch((e) => {
            c.seatsSentAt = 0;                      // try again next time
            say(c.label, "Found seats, but couldn't send them to Kyro — the seat map will be out of date",
              e instanceof Error ? e.message : String(e));
          });
        }
        for (const c of list) {
          if (c.stream && Date.now() - c.lastPicture >= PICTURE_EVERY_MS && c.countedAt) {
            c.lastPicture = Date.now();
            sendPicture(c.key, c.grabCanvas);
          }
        }
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "Couldn't reach the Kyro website");
      }
    };
    tick();
    const t = setInterval(tick, REPORT_EVERY_MS);
    return () => clearInterval(t);
  }, [phase, syncCameras]);

  // Idle but allowed: start the moment a camera is plugged in.
  useEffect(() => {
    if (phase !== "idle" || !allowed || needsPermission) return;
    let stopped = false;
    try { stopped = localStorage.getItem(ON_KEY) === "0"; } catch {}
    if (stopped) return;
    const look = async () => {
      try { if ((await listCameras()).length) start(); } catch { /* nothing plugged in */ }
    };
    navigator.mediaDevices?.addEventListener("devicechange", look);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", look);
  }, [phase, allowed, needsPermission, start]);

  // Keep the screen awake, and notice cameras being plugged in or out.
  useEffect(() => {
    if (phase !== "running") return;
    const lock = async () => {
      try { wake.current = await (navigator as unknown as { wakeLock?: { request(k: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* not supported */ }
    };
    lock();
    const onVis = () => { if (document.visibilityState === "visible") lock(); };
    const onDevices = () => { syncCameras().catch(() => {}); };
    // No "Leave site?" box.
    //
    // Closing the tab really does stop counting, and this asked before letting
    // it happen. But the browser shows that box for every reload too, and it
    // cannot tell the operator why it is asking — so what it amounted to in
    // practice was a warning on every refresh, which teaches people to click
    // through warnings without reading them. The Cameras page says plainly
    // that counting stops when the tab is closed; that is the right place for
    // it, where it can be read rather than dismissed.
    document.addEventListener("visibilitychange", onVis);
    navigator.mediaDevices.addEventListener("devicechange", onDevices);
    const poll = setInterval(onDevices, 10_000);   // some browsers don't announce plug-ins
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      navigator.mediaDevices.removeEventListener("devicechange", onDevices);
      clearInterval(poll);
    };
  }, [phase, syncCameras]);

  // Live video to anyone watching from another device. Only runs while a
  // camera is actually being watched — see lib/liveStream.ts.
  useEffect(() => {
    if (phase !== "running" || demoRef.current) return;
    const dev = savedDevice();
    if (!dev) return;
    const stop = startLiveStream({
      token: dev.token,
      frameFor: (key) => cams.current.get(key)?.video ?? null,
    });
    return stop;
  }, [phase]);

  // Tell the rest of the page that this browser is the counter, so nothing
  // reloads it out from under a service. CrashRecovery reads this.
  useEffect(() => {
    try {
      if (phase === "running") sessionStorage.setItem("kyro_counting_live", "1");
      else sessionStorage.removeItem("kyro_counting_live");
    } catch { /* fine without it */ }
  }, [phase]);

  const streamFor = useCallback((key: string) => cams.current.get(key)?.stream ?? null, []);
  // What this computer can see, with nobody counted twice.
  //
  // Adding the cameras up is the one thing a camera cannot do for itself: it
  // knows what is in front of it and cannot know whether the camera beside it
  // is looking at the same person. Two cameras pointed at one face read
  // "2 people now". The website's register sees every camera at once and
  // sends back how many of these sightings are the same person — see
  // seen_twice in worker/venue.js.
  const sum = views.filter((v) => v.streaming).reduce((n, v) => n + v.count, 0);
  const total = Math.max(0, sum - Math.min(seenTwice, Math.max(0, sum - 1)));
  const secondsPerCount = views.reduce((m, v) => Math.max(m, v.secondsPerCount), 0);

  return (
    <Ctx.Provider value={{ allowed, demo, phase, step, progress, error, sendError, lastSent, engineInfo, needsPermission, views, total, seenTwice, secondsPerCount, start, stop, streamFor }}>
      {children}
      {/* The cameras' own video elements: on the page everywhere, visible nowhere. */}
      <div ref={holder} aria-hidden style={{ position: "fixed", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }} />
    </Ctx.Provider>
  );
}
