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
  /**
   * The people actually being followed and counted, with the number Kyro
   * counts each of them as — their number in the register, which is theirs
   * for the whole service. `person` is null while the register has yet to
   * place somebody; the box is drawn without a number rather than with the
   * camera's own scratch number for it.
   */
  tracked?: { track: number; box: [number, number, number, number]; person?: number | null }[];
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
     * The people being followed, labelled with the number Kyro counts each of
     * them as.
     *
     * ── What this number has been, twice, and must not be again ────────────
     *
     * First it was the detection's POSITION IN THE LIST — 1, 2, 3 — which
     * renumbered on every frame as the order changed: "theres a lot of 1 2 1
     * 2 1 2, 4, 5 and it dosent increase".
     *
     * Then it was the camera's own track number, which is a scratch number
     * for a box being followed. It is thrown away and reissued every time
     * the detector loses somebody for a moment, and it starts ten thousand
     * higher on every reload so two browsers cannot collide: "theres one
     * that has been standing for more than 5 minutes an usher, but you have
     * given him different Id's, one time he was 20036, next hes 20057, next
     * hes 2045".
     *
     * Both looked like an identity. Neither was one. The identity is the
     * register's, it is decided on the website where every camera can be
     * compared with every other, and it is locked for the whole service —
     * so that is what is drawn. A person Kyro has not placed yet is drawn
     * with no number at all, because a number about to change is worse than
     * none: none cannot be mistaken for an identity.
     */
    const draw = tracked?.length
      ? tracked
      : people.map((p) => ({ track: 0, box: p.box, person: null as number | null }));
    draw.forEach((p) => {
      const [x1, y1, x2, y2] = p.box;
      ctx.strokeStyle = "#22c55e";
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const who = (p as { person?: number | null }).person;
      if (who == null) return;              // not placed yet: a box, and no claim about who
      const label = `${who}`;
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
