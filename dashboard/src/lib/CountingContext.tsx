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
  loadEngine, listCameras, openCamera, cameraKey, grab, countPeople, savedDevice, sendSeats,
  COUNT_WIDTH, DOOR_WIDTH,
  sendReport, sendPicture, type Engine, type CameraReport, type Zone,
} from "@/lib/cameraMode";
import { SteadyCount, COUNT_CONFIDENCE, outsideZones, type Person } from "@/lib/peopleDetector";
import { startLiveStream } from "@/lib/liveStream";
import { countOrder } from "@/lib/countOrder";
import { PersonTracker } from "@/lib/personTracker";
import { lookOf } from "@/lib/appearance";
import { PictureWatch } from "@/lib/pictureCheck";
import { SeatFinder } from "@/lib/seatFinder";
import { loadFaceEngine, type FaceEngine } from "@/lib/faceEngine";
import { loadOrt } from "@/lib/countEngine";
import { isEdgeLive, edgeTokenPayload } from "@/lib/edgeAuth";

const ON_KEY = "kyro_counting_on";          // keep counting after a reload
// An open camera with no picture for this long is worth telling someone about.
const NO_PICTURE_MS = 6_000;
// A camera missing this long is treated as gone for good, and only then are
// its figures let go.
const GONE_FOR_GOOD_MS = 5 * 60_000;
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
const MOST_FACES_AT_ONCE = 3;
/** How often the seats Kyro has found are sent to the website. They don't move. */
const SEATS_EVERY_MS = 60_000;

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
  /** Watching a doorway. It gets more turns, and never splits the picture. */
  isDoor: boolean;
  /** Watches for a black or frozen picture — see lib/pictureCheck.ts. */
  watch: PictureWatch;
  /** Finds this camera's seats by itself. Only ever for a camera on a room. */
  seatFinder: SeatFinder;
  /** When its seat list was last sent to the website. */
  seatsSentAt: number;
  tracker: PersonTracker;      // follows people between counts → arrived / left
  faces: string[] | null;      // face codes to send, when face matching is on
  facesAt: number;
}

export interface CamView {
  key: string; label: string; count: number; people: Person[]; rawPeople: Person[];
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
  const faceLoading = useRef(false);
  const wake = useRef<{ release(): Promise<void> } | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);

  const refreshViews = useCallback(() => {
    setViews([...cams.current.values()].map((c) => ({
      key: c.key, label: c.label, count: c.count, people: c.people, rawPeople: c.rawPeople,
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
          needsTiles: true, sinceTileCheck: 0, isDoor: false, tracker: new PersonTracker(), faces: null, facesAt: 0,
          watch: new PictureWatch(), seatFinder: new SeatFinder(key), seatsSentAt: 0,
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
          c.stream = await openCamera(d.deviceId);
          c.error = null;
          c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c!.stream = null; c!.error = "Unplugged"; refreshViews(); });
        } catch (e) {
          c.error = e instanceof Error && e.name === "NotReadableError"
            ? "Another program is using this camera" : "Couldn't open this camera";
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
  }, [refreshViews]);

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
        if (c.watch.saw(px) && (c.watch.black || c.watch.frozen)) {
          say(c.label, c.watch.black
            ? "The picture is black. Check the lens cap and the lighting — and if this is a HuddleCam at 1920x1080, it may need to be asked for 1280x720 instead."
            : "The same picture over and over: this camera has stopped, although it is still connected. Unplug it and plug it back in.");
        }
        // A black picture is the same fault as no picture wearing a disguise,
        // so it gets the same answer: ask the camera for less and try again.
        if (c.watch.black && c.tries < 3) {
          c.tries++;
          try {
            c.stream?.getTracks().forEach((t) => t.stop());
            c.stream = await openCamera(c.deviceId, c.tries);
            c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c.stream = null; c.error = "Unplugged"; refreshViews(); });
            if (c.video) { c.video.srcObject = c.stream; c.video.play().catch(() => {}); }
            c.watch.reset();
            c.error = null;
          } catch {
            c.error = "This camera sends a black picture at every size Kyro can ask for.";
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
          const checking = !c.isDoor && ++c.sinceTileCheck >= 10;
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
            if (!c.needsTiles) people = whole;
          }
          // Everything the AI noticed, before the "sure enough to count" cutoff,
          // so "nobody there" can be told apart from "seen but not sure".
          c.rawPeople = people;
          c.people = outsideZones(people.filter((p) => p.score >= countConfidenceRef.current), zonesRef.current[c.key], px.width, px.height);
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
    const nearest = c.people
      .map((p, i) => ({ i, size: p.box[3] - p.box[1] }))
      .sort((a, b) => b.size - a.size)
      .slice(0, MOST_FACES_AT_ONCE)
      .map((x) => x.i);
    const read = await faceEngine.current.codesFor(px, nearest.map((i) => c.people[i].box));
    const codes: (Float32Array | null)[] = c.people.map(() => null);
    nearest.forEach((person, k) => { codes[person] = read[k] ?? null; });
    c.faces = codes.filter(Boolean).map((v) => packFace(v as Float32Array));
    return codes;
  }, []);

  const stop = useCallback(() => {
    running.current = false;
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
      const list = [...cams.current.values()].filter((c) => c.stream);
      const reports: CameraReport[] = list.map((c) => {
        // Who is in which seat, as this camera sees it. Worked out once and
        // used for both the seat states and the register, so the two cannot
        // disagree about where somebody is sitting.
        const following = c.tracker.seenNow();
        const seatOf = c.isDoor ? [] : c.seatFinder.whoIsWhere(
          following.map((x) => x.box as [number, number, number, number]),
          c.video?.videoWidth || 1280, c.video?.videoHeight || 720).seatOfPerson;
        return ({
        key: c.key, label: c.label, current: c.count, peak: c.peak,
        entries: c.tracker.entries, exits: c.tracker.exits,
        // Different people, counted once each — see PersonTracker.people.
        people_seen: c.tracker.people,
        // Which of this camera's seats are taken. A seat id and a person id
        // are different things: somebody who sits in five chairs during a
        // service is five seats and one person in the attendance register.
        ...(c.isDoor ? {} : { seats: c.seatFinder.occupancy(
          c.people.map((p) => p.box as [number, number, number, number]),
          c.video?.videoWidth || 1280, c.video?.videoHeight || 720, Date.now()) }),
        // Everyone this camera is following, for the website's register of
        // people. A look is eight small numbers; a face only travels while
        // face matching is switched on, and is a list of numbers either way —
        // never a picture. See worker/identity.js.
        seen: following.slice(0, 40).map((x, i) => ({
          t: x.track,
          // Which seat this person is in, if any. Context for the register,
          // never proof of who they are — see SEAT_HELPS in identity.js.
          s: seatOf[i] ?? null,
          l: x.look ? [x.look.top[0], x.look.top[1], x.look.top[2],
                       x.look.bottom[0], x.look.bottom[1], x.look.bottom[2],
                       x.look.shape, x.look.height].map((v) => Math.round(v * 1000) / 1000) : null,
          f: faceOnRef.current && x.face ? packFace(x.face) : null,
        })),
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
      try {
        const { disabled, zones, countConfidence, faceMatching, doorways, countFrom, service, doorMode } =
          await sendReport(reports, { error: faceErr.current, ready: !!faceEngine.current }, problems.current);
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
          if (c.isDoor || Date.now() - c.seatsSentAt < SEATS_EVERY_MS) continue;
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
          if (Date.now() - c.lastPicture >= PICTURE_EVERY_MS && c.countedAt) {
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
  const total = views.filter((v) => v.streaming).reduce((n, v) => n + v.count, 0);
  const secondsPerCount = views.reduce((m, v) => Math.max(m, v.secondsPerCount), 0);

  return (
    <Ctx.Provider value={{ allowed, demo, phase, step, progress, error, sendError, lastSent, engineInfo, needsPermission, views, total, secondsPerCount, start, stop, streamFor }}>
      {children}
      {/* The cameras' own video elements: on the page everywhere, visible nowhere. */}
      <div ref={holder} aria-hidden style={{ position: "fixed", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }} />
    </Ctx.Provider>
  );
}
