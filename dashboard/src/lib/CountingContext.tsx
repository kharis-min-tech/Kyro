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
  loadEngine, listCameras, openCamera, cameraKey, grab, countPeople,
  sendReport, sendPicture, type Engine, type CameraReport, type Zone,
} from "@/lib/cameraMode";
import { SteadyCount, COUNT_CONFIDENCE, outsideZones, type Person } from "@/lib/peopleDetector";
import { PersonTracker } from "@/lib/personTracker";
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
const REPORT_EVERY_MS = 5_000;
const PICTURE_EVERY_MS = 20_000;
const FACES_EVERY_MS = 4_000;     // reading faces is costly; counting comes first

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
  /** Already reopened without asking for 1920x1080, so we don't loop on it. */
  relaxed: boolean;
  /** When this camera dropped off the list of plugged-in cameras, if it has. */
  goneSince: number;
  // Splitting the picture into tiles costs five AI runs instead of one. It only
  // finds people too small to see in the whole picture — useless on a webcam
  // with someone close up, where it made each count five times slower. So try
  // the whole picture alone, and check now and then whether tiles would add
  // anyone; if they would, keep using them for this camera.
  needsTiles: boolean; sinceTileCheck: number;
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
          countedAt: 0, secondsPerCount: 0, error: null, lastPicture: 0, noPictureSince: 0, relaxed: false, goneSince: 0,
          needsTiles: true, sinceTileCheck: 0, tracker: new PersonTracker(), faces: null, facesAt: 0,
        };
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
      for (const c of [...cams.current.values()]) {
        if (!running.current) break;
        if (!c.stream || !c.video || !engine.current) continue;
        const px = grab(c.video, c.grabCanvas);
        if (!px) {
          // The camera is open but has no picture to give. This used to be
          // skipped in silence, so the tile stayed black on "Starting…" with
          // nothing to act on. Say so once it has gone on long enough to mean
          // something.
          if (!c.noPictureSince) { c.noPictureSince = Date.now(); continue; }
          if (Date.now() - c.noPictureSince <= NO_PICTURE_MS) continue;
          if (!c.relaxed) {
            // Kyro asks every camera for 1920x1080, because more pixels means
            // people further away are still found. Some cameras accept that,
            // open happily, and then send nothing at all. Rather than tell
            // someone to crawl behind the desk and replug it, ask again for
            // nothing in particular and take what the camera wants to give.
            c.relaxed = true;
            c.noPictureSince = 0;
            try {
              c.stream?.getTracks().forEach((t) => t.stop());
              c.stream = await openCamera(c.deviceId, true);
              c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c.stream = null; c.error = "Unplugged"; refreshViews(); });
              if (c.video) { c.video.srcObject = c.stream; c.video.play().catch(() => {}); }
              c.error = null;
            } catch {
              c.error = "This camera won't give a picture. Unplug it, plug it back in, and press Start counting.";
            }
            continue;
          }
          c.error = "This camera is open but sending no picture, even at its own settings. Try a different USB socket, or unplug it and plug it back in.";
          continue;
        }
        c.noPictureSince = 0;
        const t0 = performance.now();
        try {
          // Check every 10th count whether tiles are earning their keep.
          const checking = ++c.sinceTileCheck >= 10;
          if (checking) c.sinceTileCheck = 0;
          const useTiles = c.needsTiles || checking;
          let people = await countPeople(engine.current, px, useTiles ? undefined : 1);
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
          c.tracker.update(c.people, Date.now(), codes ?? undefined);
          c.count = c.steady.add(c.people.length);
          c.peak = Math.max(c.peak, c.count);
          c.countedAt = Date.now();
          c.secondsPerCount = (performance.now() - t0) / 1000;
          c.error = null;
        } catch (e) {
          c.error = `Counting problem: ${e instanceof Error ? e.message : e}`.slice(0, 120);
        }
        did = true;
      }
      refreshViews();
      // A breather so the page stays responsive, in proportion to the work just
      // done. A flat 350 ms wasted more time than a count takes once tiling is
      // off (about 200 ms), which showed as the number lagging behind the room.
      const slowest = Math.max(0, ...[...cams.current.values()].map((c) => c.secondsPerCount * 1000));
      await new Promise((r) => setTimeout(r, did ? Math.min(350, Math.max(50, slowest * 0.25)) : 500));
    }
  }, [refreshViews]);

  /** Face codes for this camera's people, every few seconds while switched on. */
  const faceCodes = useCallback(async (c: Cam, px: ImageData): Promise<(Float32Array | null)[] | null> => {
    if (!faceOnRef.current) { c.faces = null; return null; }
    if (Date.now() - c.facesAt < FACES_EVERY_MS) return null;
    if (!faceEngine.current) {
      if (faceLoading.current) return null;
      faceLoading.current = true;
      try {
        const ort = await loadOrt();
        faceEngine.current = await loadFaceEngine(ort);
      } catch { /* carry on counting without it */ }
      finally { faceLoading.current = false; }
      if (!faceEngine.current) return null;
    }
    c.facesAt = Date.now();
    const codes = await faceEngine.current.codesFor(px, c.people.map((p) => p.box));
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
      const reports: CameraReport[] = list.map((c) => ({
        key: c.key, label: c.label, current: c.count, peak: c.peak,
        entries: c.tracker.entries, exits: c.tracker.exits,
        ...(c.faces?.length ? { faces: c.faces, faces_age_s: (Date.now() - c.facesAt) / 1000 } : {}),
        status: c.error || Date.now() - c.countedAt > 60_000 ? "error" : "online",
        error: c.error ?? (c.countedAt ? null : "Starting…"),
        fps: c.secondsPerCount ? +(1 / c.secondsPerCount).toFixed(1) : 0,
        width: c.video?.videoWidth ?? 0, height: c.video?.videoHeight ?? 0,
      }));
      try {
        const { disabled, zones, countConfidence, faceMatching } = await sendReport(reports);
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
    // Closing the tab really does stop counting, so it is still worth a warning.
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    document.addEventListener("visibilitychange", onVis);
    navigator.mediaDevices.addEventListener("devicechange", onDevices);
    window.addEventListener("beforeunload", onLeave);
    const poll = setInterval(onDevices, 10_000);   // some browsers don't announce plug-ins
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      navigator.mediaDevices.removeEventListener("devicechange", onDevices);
      window.removeEventListener("beforeunload", onLeave);
      clearInterval(poll);
    };
  }, [phase, syncCameras]);

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
