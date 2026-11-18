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
function camera(t: number) {
  // Down the aisle, from the back door towards the stage.
  const aisle = ramp(t, 0, 0.42);
  // Up and over, looking down at the room — the Seat Map, from the air.
  const over = ramp(t, 0.38, 0.68);
  // Back down to the front, facing the stage.
  const front = ramp(t, 0.66, 1);

  const z = mix(mix(44, 26, aisle), mix(26, 13, front), over);
  const y = mix(mix(2.4, 2.0, aisle), mix(2.0, 3.2, front), over) + over * (1 - front) * 22;
  const x = Math.sin(t * 3.1) * 0.9 * (1 - over);

  const atY = mix(2.2, 1.0, over) + front * 1.2;
  const atZ = mix(0, 20, over * (1 - front));
  return { x, y, z, atX: 0, atY, atZ, over };
}

export function HallScene({ progress, still = false }: { progress: () => number; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── The hall ──────────────────────────────────────────────────────────
    const seats: Seat[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let i = 0; i < PER_ROW; i++) {
        const half = PER_ROW / 2;
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
          fills: 0.08 + (row / ROWS) * 0.5 + (n / half) * 0.22
            + (Math.sin(row * 12.9898 + i * 78.233) * 0.5 + 0.5) * 0.12,
          reserved: (row === 2 || row === 3) && n <= 2,
        });
      }
    }

    let W = 0, H = 0, dpr = 1, raf = 0, shown = 0, visible = true;

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
      const cam = camera(t);
      // Look-at, flattened: the camera never rolls, so a yaw and a pitch is
      // the whole of it and the arithmetic stays readable.
      const dx = cam.atX - cam.x, dy = cam.atY - cam.y, dz = cam.atZ - cam.z;
      const yaw = Math.atan2(dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const focal = H * 0.9;

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

      // ── The stage, as a glow rather than a shape ──────────────────────
      const st = project(0, 1.4, 0.5);
      if (st) {
        const r = Math.min(W, H) * (520 / Math.max(14, st.d));
        const g = ctx.createRadialGradient(st.sx, st.sy, 0, st.sx, st.sy, Math.max(40, r));
        g.addColorStop(0, "rgba(248,181,55,0.20)");
        g.addColorStop(0.45, "rgba(139,114,255,0.07)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // ── The floor, as lines down the hall ─────────────────────────────
      ctx.lineWidth = 1;
      for (let row = 0; row <= ROWS; row++) {
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
        const taken = ramp(t, s.fills, s.fills + 0.06);
        const w = (focal * 0.46) / p.d;
        const h = w * 0.72;
        if (w < 0.7) continue;
        const fade = Math.max(0, Math.min(1, 1 - (p.d - 6) / 52));
        const lit = s.reserved ? PURPLE : GOLD;
        const c = taken > 0.02
          ? [mix(COOL[0], lit[0], taken), mix(COOL[1], lit[1], taken), mix(COOL[2], lit[2], taken)]
          : COOL;
        const alpha = (0.2 + taken * 0.75) * fade;

        if (taken > 0.2) {
          ctx.fillStyle = `rgba(${lit[0]},${lit[1]},${lit[2]},${0.16 * taken * fade})`;
          ctx.beginPath(); ctx.arc(p.sx, p.sy, w * 1.7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
        const r = Math.min(w * 0.3, 3);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(p.sx - w / 2, p.sy - h / 2, w, h, r);
        else ctx.rect(p.sx - w / 2, p.sy - h / 2, w, h);
        ctx.fill();
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
  }, [progress, still]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}
