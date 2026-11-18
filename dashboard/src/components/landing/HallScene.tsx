"use client";

import { useEffect, useRef } from "react";

/**
 * The welcome page's background: the hall itself, in three dimensions, flown
 * through by scrolling.
 *
 * Asked for as "more of a scroll-driven 3D website", with Lusion and Active
 * Theory as the references. What those do is tie a camera in a 3D scene to
 * the scrollbar, so moving down the page moves you through a space rather
 * than past a column of text.
 *
 * ── Why this is drawn by hand ─────────────────────────────────────────────
 *
 * The usual way is three.js, which is the better part of a megabyte before
 * anything is on the screen. This page is the first thing a church sees, on
 * whatever phone they have, and the thing it has to do is explain Kyro — so
 * the effect pays for itself only if it is nearly free. A church hall is
 * rows of seats on a flat floor: a few hundred boxes, all the same, no
 * textures and no lighting model. That is a page of projection arithmetic
 * and a sort, which is what this is.
 *
 * ── What you fly through ──────────────────────────────────────────────────
 *
 * Scrolling the page moves a camera down the centre aisle, lifts it over the
 * seats to look down on the room the way the Seat Map does, and brings it
 * back to rest facing the stage. The room FILLS as you go: seats light up
 * gold the further down the page you are, so scrolling is a service
 * arriving. That is Kyro's whole job, done as the background.
 *
 * Nothing here is interactive and nothing here is data. It is the welcome
 * page, shown only to people who are not signed in — anybody counting has
 * been sent to their dashboard and never loads this.
 */

/** One seat in the hall, in metres, with the stage at the origin. */
type Seat = { x: number; y: number; z: number; row: number; seat: number; fills: number; reserved: boolean };

const GOLD = [248, 181, 55] as const;
const PURPLE = [139, 114, 255] as const;
const COOL = [92, 104, 148] as const;

/**
 * The room is never empty.
 *
 * The first version filled from nothing as you scrolled, which meant the
 * top of the page — where the cards that read the count actually sit —
 * showed an empty hall and "0 people in". It looked broken, and it was:
 * "its count is also the same".
 *
 * So a service is already under way when you arrive, and scrolling brings
 * the rest of the congregation in. It also breathes on its own, slowly, so
 * somebody who never scrolls still sees a room with people arriving in it.
 */
const ALREADY_IN = 0.42;     // how full before you scroll at all
const FILLS_TO = 0.94;       // and at the bottom of the page

const ROWS = 16;
const PER_ROW = 22;
const ROW_GAP = 2.05;        // metres between rows
const SEAT_GAP = 0.98;       // metres between seats
const AISLE = 2.6;           // the gap down the middle
const FIRST_ROW_Z = 7;

/** Smooth 0→1 between a and b. The whole scene is built out of these. */
const ramp = (t: number, a: number, b: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Where the camera is, and what it is looking at, at scroll position t.
 *
 * Four places, each blended into the next. Written as positions rather than
 * angles because every one of them is somewhere a person could stand in the
 * room, which is what keeps it from feeling like a spinning logo.
 */
function camera(t: number, clock = 0) {
  // Down the aisle, from the back door towards the stage.
  const aisle = ramp(t, 0, 0.40);
  // Up and over, looking down at the room — the Seat Map, from the air.
  const over = ramp(t, 0.34, 0.62);
  // Back down among the seats, facing the stage.
  const front = ramp(t, 0.60, 1);

  const z = mix(mix(46, 24, aisle), mix(24, 9, front), over);
  // The lift is the whole middle of the journey, so it is a proper climb —
  // thirty metres up and back down, not a nod. A camera that barely moves
  // is a camera nobody notices: "i cant even see the effect".
  const y = mix(mix(2.4, 1.9, aisle), mix(1.9, 2.8, front), over) + over * (1 - front) * 30;
  // A slow drift across the aisle, and a breath of sway even standing
  // still, so the room is never a photograph.
  const x = Math.sin(t * 4.2) * 2.6 * (1 - over) + Math.sin(clock * 0.28) * 0.5 * (1 - over);
  const atY = mix(2.4, 0.6, over) + front * 1.4;
  const atZ = mix(0, 26, over * (1 - front));
  return { x, y: y + Math.sin(clock * 0.21) * 0.12, z, atX: Math.sin(clock * 0.17) * 0.35, atY, atZ, over };
}

export function HallScene({ progress, still = false, onCount }: {
  progress: () => number;
  still?: boolean;
  /** How many seats are taken, for the cards floating over the room. */
  onCount?: (occupied: number, total: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── The hall ──────────────────────────────────────────────────────────
    /**
     * A phone draws a smaller hall.
     *
     * Not for looks — three hundred and fifty projections and a sort, sixty
     * times a second, is work a laptop shrugs off and a phone does not. The
     * room reads the same because what you see of it is how far back the
     * seats go, and on a narrow screen you cannot see the far rows anyway.
     */
    const small = Math.min(window.innerWidth, window.innerHeight) < 560;
    const rows = small ? 11 : ROWS;
    const perRow = small ? 14 : PER_ROW;

    const seats: Seat[] = [];
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < perRow; i++) {
        const half = perRow / 2;
        const side = i < half ? -1 : 1;
        const n = i < half ? half - i : i - half + 1;
        seats.push({
          x: side * (AISLE / 2 + n * SEAT_GAP),
          y: 0,
          z: FIRST_ROW_Z + row * ROW_GAP,
          row,
          seat: i,
          /**
           * How far down the page this seat is taken. Front rows and middle
           * seats first, as a church actually fills, with a little scatter
           * so it never looks like a progress bar.
           */
          fills: 0.08 + (row / rows) * 0.5 + (n / half) * 0.22
            + (Math.sin(row * 12.9898 + i * 78.233) * 0.5 + 0.5) * 0.12,
          reserved: (row === 2 || row === 3) && n <= 2,
        });
      }
    }

    let W = 0, H = 0, dpr = 1, raf = 0, shown = 0, visible = true, told = -1;
    const born = performance.now();

    const size = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const t = shown;
      const clock = (performance.now() - born) / 1000;
      /**
       * How full the hall is: most of it set by how far down the page you
       * are, the rest breathing on its own so a room nobody scrolls is
       * still a room people are arriving in.
       */
      const full = Math.min(1, ALREADY_IN + (FILLS_TO - ALREADY_IN) * t
        + Math.sin(clock * 0.37) * 0.045 + Math.sin(clock * 0.11) * 0.03);
      const cam = camera(t, clock);
      // Look-at, flattened: the camera never rolls, so a yaw and a pitch is
      // the whole of it and the arithmetic stays readable.
      const dx = cam.atX - cam.x, dy = cam.atY - cam.y, dz = cam.atZ - cam.z;
      const yaw = Math.atan2(dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      /**
       * How wide the view is — and this is the phone fix.
       *
       * It was H * 0.9, which on a tall narrow screen is an extremely long
       * lens: you saw three seats and a glow, and the hall never read as a
       * hall. "its not phone proof." A phone needs a WIDER view, not a
       * taller one, so the focal length comes off the smaller side and
       * opens up further the narrower the screen gets.
       */
      const near = Math.min(W, H);
      const wide = Math.min(1, Math.max(0, (560 - W) / 360));     // 0 on a laptop, 1 on a phone
      const focal = near * mix(0.82, 0.46, wide);

      /** World metres → where it lands on the screen, or null if behind. */
      const project = (x: number, y: number, z: number) => {
        const ox = x - cam.x, oy = y - cam.y, oz = z - cam.z;
        const rx = ox * cy + oz * sy;
        const rz = -ox * sy + oz * cy;
        const ry = oy * cp - rz * sp;
        const rzz = rz * cp + oy * sp;
        const depth = -rzz;
        if (depth < 0.4) return null;
        return { sx: W / 2 + (rx * focal) / depth, sy: H / 2 - (ry * focal) / depth, d: depth };
      };

      ctx.clearRect(0, 0, W, H);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#07080d");
      sky.addColorStop(0.55, "#0b0d16");
      sky.addColorStop(1, "#05060a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // ── The stage: a glow, and light reaching into the room ───────────
      const st = project(0, 1.4, 0.5);
      if (st) {
        const r = Math.min(W, H) * (620 / Math.max(14, st.d));
        const pulse = 0.82 + Math.sin(clock * 0.9) * 0.18;
        const g = ctx.createRadialGradient(st.sx, st.sy, 0, st.sx, st.sy, Math.max(60, r));
        g.addColorStop(0, `rgba(248,181,55,${0.34 * pulse})`);
        g.addColorStop(0.35, `rgba(214,150,70,${0.13 * pulse})`);
        g.addColorStop(0.7, "rgba(139,114,255,0.08)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        /**
         * Three beams sweeping out over the congregation.
         *
         * The room was right and dull — "its very boring". A dark hall full
         * of small dots is a diagram. What makes a room feel like a room is
         * light moving through it, so the stage throws beams that swing
         * slowly across the seats and catch the haze.
         */
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
          const swing = Math.sin(clock * 0.23 + i * 2.1) * 13 + (i - 1) * 7;
          const far = project(swing, 0.1, 34);
          if (!far) continue;
          const beam = ctx.createLinearGradient(st.sx, st.sy, far.sx, far.sy);
          const strength = (0.085 + Math.sin(clock * 0.5 + i) * 0.03) * (1 - cam.over * 0.5);
          beam.addColorStop(0, `rgba(248,196,120,${Math.max(0, strength)})`);
          beam.addColorStop(0.6, "rgba(180,150,255,0.03)");
          beam.addColorStop(1, "rgba(0,0,0,0)");
          const spread = Math.max(30, Math.min(W, H) * 0.16);
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(st.sx, st.sy);
          ctx.lineTo(far.sx - spread, far.sy);
          ctx.lineTo(far.sx + spread, far.sy);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // ── The floor, as lines down the hall ─────────────────────────────
      ctx.lineWidth = 1;
      for (let row = 0; row <= rows; row++) {
        const z = FIRST_ROW_Z + row * ROW_GAP - ROW_GAP / 2;
        const a = project(-13, 0, z), b = project(13, 0, z);
        if (!a || !b) continue;
        ctx.strokeStyle = `rgba(120,134,180,${Math.max(0, 0.1 - a.d / 900)})`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }

      // ── The seats, furthest first so nearer ones cover them ───────────
      const drawn: { p: NonNullable<ReturnType<typeof project>>; s: Seat }[] = [];
      for (const s of seats) {
        const p = project(s.x, s.y + 0.42, s.z);
        if (p) drawn.push({ p, s });
      }
      drawn.sort((a, b) => b.p.d - a.p.d);

      for (const { p, s } of drawn) {
        // Taken, and how recently — a seat flares as somebody sits in it,
        // which is what makes a filling room read as movement rather than
        // as a bar chart slowly going gold.
        const taken = ramp(full, s.fills - 0.05, s.fills + 0.03);
        const justNow = taken > 0.04 && taken < 0.96 ? Math.sin(taken * Math.PI) : 0;
        const w = (focal * 0.46) / p.d;
        const h = w * 0.72;
        if (w < 0.7) continue;
        const fade = Math.max(0, Math.min(1, 1 - (p.d - 6) / 52));
        const lit = s.reserved ? PURPLE : GOLD;
        const c = taken > 0.02
          ? [mix(COOL[0], lit[0], taken), mix(COOL[1], lit[1], taken), mix(COOL[2], lit[2], taken)]
          : COOL;
        const alpha = (0.2 + taken * 0.75) * fade;

        if (taken > 0.12) {
          const halo = (0.18 * taken + 0.5 * justNow) * fade;
          ctx.fillStyle = `rgba(${lit[0]},${lit[1]},${lit[2]},${halo})`;
          ctx.beginPath(); ctx.arc(p.sx, p.sy, w * (1.7 + justNow * 2.4), 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
        const r = Math.min(w * 0.3, 3);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(p.sx - w / 2, p.sy - h / 2, w, h, r);
        else ctx.rect(p.sx - w / 2, p.sy - h / 2, w, h);
        ctx.fill();
      }

      /**
       * …and how full the room is, for the cards floating over it.
       *
       * Counted from the same seats being drawn, so the figure on the card
       * and the gold in the room can never disagree — which is the whole
       * reason the card is believable.
       */
      if (onCount) {
        let taken = 0;
        for (const s of seats) if (full >= s.fills) taken++;
        if (taken !== told) { told = taken; onCount(taken, seats.length); }
      }

      // ── A haze over the far end, so the room has no visible edge ──────
      const haze = ctx.createLinearGradient(0, 0, 0, H);
      haze.addColorStop(0, "rgba(5,6,10,0.72)");
      haze.addColorStop(0.42, "rgba(5,6,10,0)");
      haze.addColorStop(1, "rgba(5,6,10,0.55)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, W, H);
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const want = Math.min(1, Math.max(0, progress()));
      // Eased, so a flicked scrollbar glides rather than snapping — this is
      // what makes it feel like a camera and not a slider.
      shown += (want - shown) * 0.08;
      if (Math.abs(want - shown) < 0.0004) shown = want;
      draw();
    };

    size();
    if (still) { shown = 0.34; draw(); return () => {}; }

    const onResize = () => { size(); draw(); };
    const onVis = () => { visible = !document.hidden; };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [progress, still, onCount]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}
