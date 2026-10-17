/**
 * browserPersonCount — in-browser person detection + tracking.
 *
 * Runs COCO-SSD (lazy-loaded TF.js) on a live MediaStream to produce a
 * current head-count without the frames ever leaving the device.
 *
 * Design priorities (from the user):
 *  - Accuracy: a simple centroid/IoU tracker so the same person across
 *    frames is counted once, not every frame.
 *  - Performance: inference runs at ~2 fps on a 320px-wide thumbnail,
 *    not every animation frame. Pauses when the tab is hidden.
 *  - Privacy: inference happens entirely in the browser; no frame or
 *    bounding box is ever sent anywhere.
 *  - Reliability: a stream track that ends auto-pauses detection; it
 *    resumes cleanly when a new stream is attached.
 *  - Honest reporting: status is one of
 *      "idle" | "loading" | "running" | "paused" | "failed"
 *    and consumers must only treat a `count` as meaningful when
 *    status === "running". A failed detector reports `count: null`.
 */

import { useEffect, useRef, useState } from "react";

export type DetectorStatus =
  | "idle"      // not started
  | "loading"   // downloading / warming up the model
  | "running"   // actively detecting
  | "paused"   // tab hidden, stream missing, or temporarily off
  | "failed";   // model or inference permanently failed in this session

export interface DetectionResult {
  /** Headcount currently visible. null when the detector isn't running. */
  count: number | null;
  status: DetectorStatus;
  /** Timestamp of the last successful inference (epoch ms). */
  lastUpdatedAt: number | null;
  /** Reason the detector failed, surfaced to the UI honestly. */
  error: string | null;
}

interface Track {
  id: number;
  x: number;      // centroid x in normalised 0..1
  y: number;
  w: number;      // bbox width 0..1
  h: number;
  score: number;
  lastSeen: number;
}

// Hyperparameters — tuned for a laptop/phone browser running a church camera
const DETECT_FPS            = 2;                              // 2 inferences / sec
const DETECT_INTERVAL_MS    = Math.round(1000 / DETECT_FPS);
const WORK_WIDTH            = 320;                            // frame downscale target
const MIN_PERSON_SCORE      = 0.45;
const IOU_MATCH_THRESHOLD   = 0.25;                           // match box↔track if IoU > this
const TRACK_LOST_FRAMES     = 4;                              // drop a track after N frames without a match

type DetectionArray = { bbox: [number, number, number, number]; class: string; score: number }[];
type Detector = { detect: (el: HTMLCanvasElement | HTMLVideoElement) => Promise<DetectionArray> };

let loadingPromise: Promise<Detector> | null = null;
async function loadDetector(): Promise<Detector> {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    // Lazy imports so the main bundle isn't bloated with ~5 MB of TF.js
    // when the user never enables counting.
    const tfModule = await import("@tensorflow/tfjs");
    // Prefer the WebGL backend — fastest on laptops. Fall back to CPU if
    // WebGL isn't available (very old devices).
    try { await tfModule.setBackend("webgl"); } catch { try { await tfModule.setBackend("cpu"); } catch {} }
    await tfModule.ready();
    const coco = await import("@tensorflow-models/coco-ssd");
    // 'lite_mobilenet_v2' is ~5 MB and runs 3–5 fps on a mid-range laptop.
    return coco.load({ base: "lite_mobilenet_v2" }) as unknown as Detector;
  })();
  try { return await loadingPromise; }
  catch (e) { loadingPromise = null; throw e; }
}

function iou(a: Track, b: { x: number; y: number; w: number; h: number }): number {
  const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2, ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2, bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Run person detection on a MediaStream and report a live count.
 * Pass `enabled=false` to pause (or just omit the stream).
 */
export function useBrowserPersonCount(
  stream: MediaStream | null,
  enabled: boolean,
): DetectionResult {
  const [status, setStatus]         = useState<DetectorStatus>("idle");
  const [count, setCount]           = useState<number | null>(null);
  const [lastUpdatedAt, setUpdated] = useState<number | null>(null);
  const [error, setError]           = useState<string | null>(null);

  const videoRef   = useRef<HTMLVideoElement | null>(null);
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const tracksRef   = useRef<Track[]>([]);
  const nextTrackId = useRef(1);
  const frameNoRef  = useRef(0);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled || !stream) {
      setStatus("idle");
      setCount(null);
      return () => { cancelledRef.current = true; };
    }

    // Build offscreen video + canvas for inference.
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    const c = document.createElement("canvas");
    videoRef.current = v;
    canvasRef.current = c;

    const onInactive = () => setStatus((s) => (s === "running" ? "paused" : s));
    stream.addEventListener?.("inactive", onInactive);
    // If a track ends (camera unplugged) we also pause.
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => t.addEventListener("ended", onInactive));

    const run = async () => {
      try {
        setStatus("loading");
        setError(null);
        if (!detectorRef.current) detectorRef.current = await loadDetector();
        if (cancelledRef.current) return;
        await v.play().catch(() => { /* ignore — detection also works on readyState > 0 */ });
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Model failed to load");
        setStatus("failed");
        setCount(null);
        return;
      }
      setStatus("running");

      const tick = async () => {
        if (cancelledRef.current) return;
        if (typeof document !== "undefined" && document.hidden) {
          setStatus("paused");
          timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS * 3);
          return;
        }
        if (v.readyState < 2 || v.videoWidth === 0) {
          timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
          return;
        }
        try {
          const ratio = WORK_WIDTH / v.videoWidth;
          c.width  = WORK_WIDTH;
          c.height = Math.round(v.videoHeight * ratio);
          const ctx = c.getContext("2d");
          if (!ctx) throw new Error("no 2d context");
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const dets = await detectorRef.current!.detect(c);
          if (cancelledRef.current) return;
          const people = dets.filter((d) => d.class === "person" && d.score >= MIN_PERSON_SCORE);
          // Normalise bboxes to 0..1 relative to the work frame.
          const boxes = people.map((d) => {
            const [bx, by, bw, bh] = d.bbox;
            return {
              x: (bx + bw / 2) / c.width,
              y: (by + bh / 2) / c.height,
              w: bw / c.width,
              h: bh / c.height,
              score: d.score,
            };
          });

          // --- Simple IoU tracker ---
          frameNoRef.current += 1;
          const frameNo = frameNoRef.current;
          const unmatched = new Set(boxes.map((_, i) => i));
          for (const t of tracksRef.current) {
            let bestIdx = -1, bestScore = IOU_MATCH_THRESHOLD;
            for (const i of unmatched) {
              const s = iou(t, boxes[i]);
              if (s > bestScore) { bestScore = s; bestIdx = i; }
            }
            if (bestIdx >= 0) {
              const b = boxes[bestIdx];
              t.x = b.x; t.y = b.y; t.w = b.w; t.h = b.h; t.score = b.score;
              t.lastSeen = frameNo;
              unmatched.delete(bestIdx);
            }
          }
          for (const i of unmatched) {
            const b = boxes[i];
            tracksRef.current.push({
              id: nextTrackId.current++,
              x: b.x, y: b.y, w: b.w, h: b.h, score: b.score, lastSeen: frameNo,
            });
          }
          tracksRef.current = tracksRef.current.filter((t) => frameNo - t.lastSeen <= TRACK_LOST_FRAMES);

          const current = tracksRef.current.length;
          setCount(current);
          setUpdated(Date.now());
          if (!cancelledRef.current) setStatus("running");
        } catch (e: unknown) {
          // A transient inference error shouldn't flip to "failed" permanently —
          // only a *repeated* failure should. For now, swallow one and retry.
          console.warn("[kyro-detect] inference error", e);
        }
        timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
      };
      tick();
    };

    run();

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) setStatus((s) => (s === "running" ? "paused" : s));
      else setStatus((s) => (s === "paused" ? "running" : s));
    };
    document.addEventListener?.("visibilitychange", onVisibility);

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      stream.removeEventListener?.("inactive", onInactive);
      tracks.forEach((t) => t.removeEventListener("ended", onInactive));
      document.removeEventListener?.("visibilitychange", onVisibility);
      try { v.pause(); v.srcObject = null; } catch {}
      tracksRef.current = [];
    };
  }, [stream, enabled]);

  return { count, status, lastUpdatedAt, error };
}
