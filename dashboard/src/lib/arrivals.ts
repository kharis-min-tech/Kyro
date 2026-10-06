/**
 * arrivals.ts — turn cumulative entry / exit counters into "how many people
 * arrived / left in each time slot", so the Attendance page can show when
 * people arrive the most.
 *
 * The vision pipeline stores running totals (total_entries, total_exits)
 * with a timestamp every couple of minutes. The difference between two
 * consecutive snapshots is the arrivals / departures in that gap.
 */

export interface CounterPoint {
  t: number;        // epoch ms
  entries: number;  // cumulative since the session started
  exits: number;
}

export interface Slot {
  start: number;    // epoch ms, slot start (local-time aligned)
  arrived: number;
  left: number;
}

export interface ArrivalSummary {
  slots: Slot[];
  totalArrived: number;
  totalLeft: number;
  peakArrival: Slot | null;
  peakDeparture: Slot | null;
  firstArrival: number | null;   // epoch ms of the first slot with arrivals
  halfArrivedBy: number | null;  // end of the slot where cumulative arrivals reached 50%
}

/** Align to the start of a local-time slot (e.g. 9:45, 10:00 for 15-min slots). */
function slotStart(t: number, minutes: number): number {
  const d = new Date(t);
  const mins = d.getHours() * 60 + d.getMinutes();
  d.setHours(0, Math.floor(mins / minutes) * minutes, 0, 0);
  return d.getTime();
}

/**
 * Bucket one or more cameras' counter series into time slots.
 * Each series is diffed on its own (counters are per camera) and the
 * results are summed per slot. A counter that goes DOWN means the
 * session restarted, so the new value is counted from zero.
 */
export function bucketArrivals(series: CounterPoint[][], minutes: number): ArrivalSummary {
  const byStart = new Map<number, Slot>();
  const add = (t: number, arrived: number, left: number) => {
    if (arrived <= 0 && left <= 0) return;
    const s = slotStart(t, minutes);
    const slot = byStart.get(s) ?? { start: s, arrived: 0, left: 0 };
    slot.arrived += Math.max(0, arrived);
    slot.left += Math.max(0, left);
    byStart.set(s, slot);
  };

  for (const raw of series) {
    const pts = [...raw].filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    pts.forEach((p, i) => {
      const prev = i === 0 ? { entries: 0, exits: 0 } : pts[i - 1];
      const dIn  = p.entries >= prev.entries ? p.entries - prev.entries : p.entries;
      const dOut = p.exits   >= prev.exits   ? p.exits   - prev.exits   : p.exits;
      add(p.t, dIn, dOut);
    });
  }

  const active = [...byStart.values()].sort((a, b) => a.start - b.start);
  // Fill gaps between the first and last active slot so the time axis is
  // continuous (an empty 10:30 slot is information too).
  const slots: Slot[] = [];
  if (active.length) {
    const step = minutes * 60_000;
    for (let s = active[0].start; s <= active[active.length - 1].start; s += step) {
      // Re-align each step to local time so DST changes don't drift slots.
      const aligned = slotStart(s, minutes);
      slots.push(byStart.get(aligned) ?? { start: aligned, arrived: 0, left: 0 });
    }
  }

  const totalArrived = slots.reduce((n, s) => n + s.arrived, 0);
  const totalLeft = slots.reduce((n, s) => n + s.left, 0);
  const peak = (key: "arrived" | "left") =>
    slots.reduce<Slot | null>((best, s) => (s[key] > 0 && (!best || s[key] > best[key]) ? s : best), null);

  let halfArrivedBy: number | null = null;
  if (totalArrived > 0) {
    let run = 0;
    for (const s of slots) {
      run += s.arrived;
      if (run >= totalArrived / 2) { halfArrivedBy = s.start + minutes * 60_000; break; }
    }
  }

  return {
    slots,
    totalArrived,
    totalLeft,
    peakArrival: peak("arrived"),
    peakDeparture: peak("left"),
    firstArrival: slots.find((s) => s.arrived > 0)?.start ?? null,
    halfArrivedBy,
  };
}

/**
 * The backend stores timestamps as naive UTC ("2026-10-05T09:45:00").
 * `new Date()` would read that as LOCAL time, shifting every slot by the
 * UTC offset — so treat a timestamp without a zone suffix as UTC.
 */
export function parseBackendTime(ts: string): number {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`).getTime();
}

/**
 * Demo-mode sample: a believable Sunday with a 10:00 service — doors at
 * 8:30, most people arriving 9:40–10:05, latecomers until ~10:45, a
 * trickle of exits during the service and the main exit after 12:00.
 * Deterministic per date so the chart doesn't reshuffle on every render.
 */
export function demoCounterSeries(day: Date, totalPeople: number): CounterPoint[] {
  let seed = day.getFullYear() * 372 + day.getMonth() * 31 + day.getDate();
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const at = (h: number, m: number) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d.getTime(); };
  const gauss = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));

  // Minute-of-day weights for arrivals / departures.
  const startMin = 8 * 60 + 30, endMin = 13 * 60 + 15, stepMin = 2;
  const inW: number[] = [], outW: number[] = [];
  for (let m = startMin; m <= endMin; m += stepMin) {
    inW.push(gauss(m, 9 * 60 + 52, 14) + 0.35 * gauss(m, 10 * 60 + 15, 18) + 0.12 * gauss(m, 9 * 60 + 15, 20));
    outW.push(0.06 * (m > 10 * 60 + 20 && m < 12 * 60 ? 1 : 0) + gauss(m, 12 * 60 + 18, 12) + 0.3 * gauss(m, 12 * 60 + 45, 14));
  }
  const inSum = inW.reduce((a, b) => a + b, 0), outSum = outW.reduce((a, b) => a + b, 0);
  const leaving = Math.round(totalPeople * 0.96);

  const pts: CounterPoint[] = [];
  let entries = 0, exits = 0, inAcc = 0, outAcc = 0;
  inW.forEach((w, i) => {
    inAcc += (w / inSum) * totalPeople * (0.85 + rand() * 0.3);
    outAcc += (outW[i] / outSum) * leaving * (0.85 + rand() * 0.3);
    entries = Math.min(totalPeople, Math.round(inAcc));
    exits = Math.min(entries, leaving, Math.round(outAcc));
    const m = startMin + i * stepMin;
    pts.push({ t: at(Math.floor(m / 60), m % 60), entries, exits });
  });
  return pts;
}
