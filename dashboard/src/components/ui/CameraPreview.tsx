"use client";

import { useEffect, useRef } from "react";
import type { Person } from "@/lib/peopleDetector";

/**
 * The camera's own picture with a box round everyone being counted.
 *
 * Straight from the camera on this computer, so it is genuinely live — no
 * snapshots, no delay. The boxes are what matters: if the number looks wrong,
 * the boxes show WHY (a poster on the wall, a face on a screen, the camera
 * seeing its own preview on the monitor).
 */
export function CameraPreview({ stream, people, tracked, count }: {
  stream: MediaStream | null;
  /** Every detection in the last frame — the fallback when nothing is followed yet. */
  people: Person[];
  /** The people actually being followed and counted, with this camera's own number for each. */
  tracked?: { track: number; box: [number, number, number, number] }[];
  count: number;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const v = video.current;
    if (!v || !stream) return;
    if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
  }, [stream]);

  // Draw the boxes over the picture, in the picture's own coordinates.
  useEffect(() => {
    const c = canvas.current, v = video.current;
    if (!c || !v) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(2, Math.round(w / 320));
    ctx.font = `${Math.max(12, Math.round(w / 55))}px system-ui, sans-serif`;
    /**
     * The people being followed, labelled with this camera's own number for
     * each of them.
     *
     * It used to draw the raw detections and label each one with its
     * POSITION IN THE LIST — 1, 2, 3 — which renumbered on every frame as
     * the order changed, so the same person flickered between numbers and
     * nothing ever counted upwards. It looked like an identity and was not
     * one. Reported as: "theres a lot of 1 2 1 2 1 2, 4, 5 and it dosent
     * increase, is this normal".
     *
     * These are also the people the figure beside the picture is made of —
     * the detections included ones not yet confirmed, so the boxes and the
     * count could disagree.
     */
    const draw = tracked?.length ? tracked : people.map((p, i) => ({ track: i + 1, box: p.box }));
    draw.forEach((p) => {
      const [x1, y1, x2, y2] = p.box;
      ctx.strokeStyle = "#22c55e";
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const label = `${p.track}`;
      const pad = ctx.lineWidth * 2;
      const tw = ctx.measureText(label).width + pad * 2;
      const th = parseInt(ctx.font, 10) + pad;
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(x1, Math.max(0, y1 - th), tw, th);
      ctx.fillStyle = "#06240f";
      ctx.fillText(label, x1 + pad, Math.max(th - pad, y1 - pad));
    });
  }, [people, tracked]);

  if (!stream) return null;

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: "#0f1222", aspectRatio: "16 / 9" }}>
      <video ref={video} muted playsInline className="absolute inset-0 w-full h-full object-contain" />
      <canvas ref={canvas} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
      <span className="absolute bottom-1.5 left-2 px-1.5 py-0.5 rounded text-xs font-semibold text-white keep-white"
        style={{ background: "rgba(15,18,34,0.75)" }}>
        {count} {count === 1 ? "person" : "people"} counted
      </span>
    </div>
  );
}
