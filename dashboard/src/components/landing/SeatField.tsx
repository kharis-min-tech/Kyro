"use client";

import { useEffect, useRef } from "react";

/**
 * The welcome page's background: an auditorium seen from the back, drawn
 * seat by seat — Kyro's Seat Map brought to life. Seats light up gold as
 * people arrive, a few are reserved (purple), and a soft camera scan sweeps
 * out from the stage. Loops like a service: doors open → the room fills →
 * service → people leave. Drawn on a canvas, so it's sharp at any size and
 * costs almost nothing to load.
 *
 * onCount(occupied, total) reports the live count for the cards on top.
 */

type Seat = { x: number; y: number; r: number; row: number; occ: boolean; reserved: boolean; at: number; w: number };

const LOOP = 26;           // seconds per "service"
const GOLD = [248, 181, 55];
const PURPLE = [139, 114, 255];

/** How full the room should be at time t (0..1) in the loop. */
function target(t: number) {
  const x = t % LOOP;
  if (x < 2) return 0.04;
  if (x < 16) { const k = (x - 2) / 14; return 0.04 + 0.84 * (1 - Math.pow(1 - k, 2.2)); } // doors open
  if (x < 22) return 0.88;                                                                   // service
  return 0.88 - 0.84 * ((x - 22) / 4);                                                        // people leave
}

export function SeatField({ onCount, still = false }: { onCount?: (occupied: number, total: number) => void; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let seats: Seat[] = [];
    let W = 0, H = 0, dpr = 1, stageX = 0, stageY = 0, raf = 0, last = performance.now();
    let clock = 0, lastReport = -1, visible = true;

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      const phone = W < 640;
      // Stage at the back (upper middle); rows curve towards the viewer.
      stageX = W / 2; stageY = H * (phone ? 0.78 : 0.58);
      const rows = phone ? 13 : 17;
      const span = phone ? 1.05 : 1.15;                        // half-angle of each row (radians)
      const near = Math.max(W, H * 1.4);
      const prev = seats;
      seats = [];
      let i = 0;
      for (let r = 0; r < rows; r++) {
        const k = r / (rows - 1);
        const radius = H * 0.1 + Math.pow(k, 1.25) * near * 0.62;
        const squash = 0.42 + k * 0.18;                          // perspective: far rows flatter
        const size = (phone ? 1.6 : 1.9) + k * (phone ? 3.0 : 4.4);
        const gap = size * 3.1;
        const n = Math.max(8, Math.floor((radius * span * 2) / gap));
        for (let s = 0; s < n; s++) {
          const a = -span + (s + 0.5) * ((span * 2) / n);
          // two aisles
          if (Math.abs(a + span / 3) < 0.035 + 0.01 * (1 - k) || Math.abs(a - span / 3) < 0.035 + 0.01 * (1 - k)) continue;
          const x = stageX + Math.sin(a) * radius;
          const y = stageY + Math.cos(a) * radius * squash;
          if (y > H + 20 || x < -20 || x > W + 20) continue;
          const old = prev[i];
          // People prefer the middle and the front-centre: arrival weight.
          const w = (1 - Math.abs(a) / span) * 0.7 + (1 - Math.abs(k - 0.35)) * 0.6 + Math.random() * 0.5;
          seats.push({ x, y, r: size, row: r, occ: old?.occ ?? false, reserved: old?.reserved ?? Math.random() < 0.025, at: old?.at ?? -10, w });
          i++;
        }
      }
    };

    const step = (dt: number) => {
      clock += dt;
      const want = Math.round(target(clock) * seats.length);
      let occ = seats.reduce((n, s) => n + (s.occ || s.reserved ? 1 : 0), 0);
      // Change a few seats each frame towards the target (arrivals in weighted order).
      const changes = Math.min(Math.abs(want - occ), Math.max(1, Math.round(seats.length * 0.012)));
      for (let c = 0; c < changes; c++) {
        if (want > occ) {
          let best: Seat | null = null, bw = -1;
          for (let t = 0; t < 14; t++) { const s = seats[(Math.random() * seats.length) | 0]; if (!s.occ && !s.reserved && s.w > bw) { best = s; bw = s.w; } }
          if (best) { best.occ = true; best.at = clock; occ++; }
        } else if (want < occ) {
          for (let t = 0; t < 14; t++) { const s = seats[(Math.random() * seats.length) | 0]; if (s.occ) { s.occ = false; s.at = clock; occ--; break; } }
        }
      }
      if (onCount && Math.floor(clock * 6) !== lastReport) { lastReport = Math.floor(clock * 6); onCount(occ, seats.length); }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Stage glow
      const g = ctx.createRadialGradient(stageX, stageY - H * 0.03, 0, stageX, stageY - H * 0.03, W * 0.45);
      g.addColorStop(0, "rgba(107,79,224,0.30)"); g.addColorStop(0.45, "rgba(107,79,224,0.08)"); g.addColorStop(1, "rgba(107,79,224,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(201,188,255,0.55)"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.ellipse(stageX, stageY - H * 0.02, W * 0.13, H * 0.035, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
      // Camera scan: a soft ring travelling out from the stage every 6 s
      const scan = ((clock % 6) / 6);
      const sr = H * 0.1 + scan * Math.max(W, H * 1.4) * 0.66;
      ctx.strokeStyle = `rgba(248,181,55,${0.16 * (1 - scan)})`; ctx.lineWidth = 18 * (1 - scan) + 2;
      ctx.beginPath(); ctx.ellipse(stageX, stageY, sr, sr * 0.5, 0, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
      // Seats — dimmed behind the headline, text and buttons so they stay easy to read
      const tx = W / 2, ty = H * (W < 640 ? 0.5 : 0.52), rx = Math.min(W * 0.36, 560), ry = H * (W < 640 ? 0.36 : 0.32);
      for (const s of seats) {
        const d = Math.hypot((s.x - tx) / rx, (s.y - ty) / ry);
        const quiet = d >= 1.3 ? 1 : d <= 0.9 ? 0.16 : 0.16 + 0.84 * ((d - 0.9) / 0.4);
        const fresh = Math.max(0, 1 - (clock - s.at) / 1.2);
        let col: number[], alpha: number;
        if (s.reserved) { col = PURPLE; alpha = 0.85; }
        else if (s.occ) { col = GOLD; alpha = 0.78 + fresh * 0.22; }
        else { col = [244, 239, 230]; alpha = 0.11 + fresh * 0.25; }
        alpha *= quiet;
        if (s.occ && fresh > 0) {
          ctx.fillStyle = `rgba(${GOLD},${0.35 * fresh * quiet})`;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1.6 + fresh * 1.6), 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${col},${alpha})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (visible) { step(dt); draw(); }
      raf = requestAnimationFrame(frame);
    };

    layout();
    if (still) {
      // Reduced motion: one calm frame of a nearly full room.
      for (let k = 0; k < 400; k++) step(0.05);   // → 20 s in: the service, room nearly full
      draw();
    } else {
      raf = requestAnimationFrame(frame);
    }
    const onResize = () => { layout(); if (still) draw(); };
    window.addEventListener("resize", onResize);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); });
    io.observe(canvas);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); io.disconnect(); };
  }, [onCount, still]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
