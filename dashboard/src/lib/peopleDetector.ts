/**
 * peopleDetector.ts — finds people in a picture with YOLO11, in the browser
 * (Camera mode). The same method as the camera computer (ai/detection/
 * detector.py): the whole picture is checked, then — for big pictures — an
 * overlapping grid of tiles, each at full model resolution, so people at the
 * back of a hall are big enough to be found. Results are merged so nobody is
 * counted twice.
 *
 * Pure code (no DOM): the caller supplies RGBA pixels and a function that
 * runs the model, so this also runs in Node for accuracy tests.
 */

export const MODEL_SIZE = 640;

export interface Pixels { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface Person { box: [number, number, number, number]; score: number }
/** Runs the model on a 1×3×S×S float tensor (RGB, 0–1) → raw output (1×84×N). */
export type RunModel = (input: Float32Array) => Promise<Float32Array>;

export interface DetectOptions {
  /** Tiles per side: 1 = whole picture only. "auto" = 2 for pictures bigger than the model input, 3 for 4K. */
  tiles?: number | "auto";
  tileOverlap?: number;
  /** Lowest confidence kept (the count uses a higher one, see COUNT_CONFIDENCE). */
  minScore?: number;
  mergeIou?: number;
  mergeContainment?: number;
  /** The model's input size (640, or 1280 for the high-detail model). */
  size?: number;
}

/** A person counts when the model is at least this sure. */
export const COUNT_CONFIDENCE = 0.3;

/** Letterbox one region of the picture into the model's 640×640 input (bilinear). */
function toTensor(px: Pixels, sx: number, sy: number, sw: number, sh: number, S: number) {
  const r = Math.min(S / sw, S / sh);
  const nw = Math.round(sw * r), nh = Math.round(sh * r);
  const ox = Math.floor((S - nw) / 2), oy = Math.floor((S - nh) / 2);
  const t = new Float32Array(3 * S * S).fill(114 / 255);
  const { data, width, height } = px;
  const plane = S * S;
  for (let y = 0; y < nh; y++) {
    const fy = sy + (y + 0.5) / r - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < nw; x++) {
      const fx = sx + (x + 0.5) / r - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = Math.max(0, Math.min(1, fx - x0));
      const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4, c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4;
      const o = (oy + y) * S + (ox + x);
      for (let ch = 0; ch < 3; ch++) {
        const top = data[a + ch] * (1 - wx) + data[b + ch] * wx;
        const bot = data[c + ch] * (1 - wx) + data[d + ch] * wx;
        t[ch * plane + o] = (top * (1 - wy) + bot * wy) / 255;
      }
    }
  }
  return { tensor: t, r, ox, oy };
}

/** Raw YOLO output → person boxes in picture coordinates. */
function decode(out: Float32Array, r: number, ox: number, oy: number, sx: number, sy: number, minScore: number): Person[] {
  const n = out.length / 84;  // 8400 candidates; row 4 = "person" score
  const found: Person[] = [];
  for (let i = 0; i < n; i++) {
    const score = out[4 * n + i];
    if (score < minScore) continue;
    const cx = out[i], cy = out[n + i], w = out[2 * n + i], h = out[3 * n + i];
    found.push({
      score,
      box: [
        (cx - w / 2 - ox) / r + sx, (cy - h / 2 - oy) / r + sy,
        (cx + w / 2 - ox) / r + sx, (cy + h / 2 - oy) / r + sy,
      ],
    });
  }
  return nms(found, 0.6);
}

const area = (b: Person["box"]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function overlap(a: Person["box"], b: Person["box"]) {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return iw * ih;
}

function nms<T extends Person>(items: T[], iou: number): T[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const p of sorted) {
    const pa = area(p.box);
    if (kept.every((k) => { const i = overlap(p.box, k.box); return i / (pa + area(k.box) - i + 1e-9) <= iou; })) kept.push(p);
  }
  return kept;
}

function tileGrid(px: Pixels, tiles: DetectOptions["tiles"], size: number): number {
  if (typeof tiles === "number") return Math.max(1, Math.floor(tiles));
  const longest = Math.max(px.width, px.height);
  if (longest > size * 4) return 3;          // 4K
  return longest > size * 1.25 ? 2 : 1;
}

export async function detectPeople(px: Pixels, run: RunModel, opts: DetectOptions = {}): Promise<Person[]> {
  const minScore = opts.minScore ?? 0.1;
  const size = opts.size ?? MODEL_SIZE;
  const pass = async (sx: number, sy: number, sw: number, sh: number) => {
    const { tensor, r, ox, oy } = toTensor(px, sx, sy, sw, sh, size);
    return decode(await run(tensor), r, ox, oy, sx, sy, minScore);
  };

  const whole = await pass(0, 0, px.width, px.height);
  const grid = tileGrid(px, opts.tiles ?? "auto", size);
  if (grid <= 1) return whole;

  const W = px.width, H = px.height, ov = opts.tileOverlap ?? 0.25;
  const tw = Math.floor(W / (grid - (grid - 1) * ov)), th = Math.floor(H / (grid - (grid - 1) * ov));
  const all: (Person & { edge: boolean })[] = whole.map((p) => ({ ...p, edge: false }));
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = Math.floor(((W - tw) * gx) / (grid - 1)), y = Math.floor(((H - th) * gy) / (grid - 1));
      const m = 3;
      for (const p of await pass(x, y, tw, th)) {
        const [x1, y1, x2, y2] = p.box;
        // Cut off by an INNER tile edge (not the picture's edge) → maybe half a person.
        const edge = (x1 <= x + m && x > 0) || (y1 <= y + m && y > 0) || (x2 >= x + tw - m && x + tw < W) || (y2 >= y + th - m && y + th < H);
        all.push({ ...p, edge });
      }
    }
  }
  const merged = nms(all, opts.mergeIou ?? 0.55);
  const containment = opts.mergeContainment ?? 0.6;
  // Drop a tile-edge fragment lying mostly inside a bigger box. Only fragments:
  // someone sitting behind another person also lies inside their box.
  return merged
    .filter((p) => !p.edge || !merged.some((q) => q !== p && area(q.box) >= area(p.box) * 1.3 && overlap(p.box, q.box) / (area(p.box) || 1) > containment))
    .map(({ box, score }) => ({ box, score }));
}

/** Smooths the headcount: the middle of the last few readings, so one odd picture doesn't make it jump. */
export class SteadyCount {
  private readings: number[] = [];
  constructor(private size = 5) {}
  add(n: number): number {
    this.readings.push(n);
    if (this.readings.length > this.size) this.readings.shift();
    const s = [...this.readings].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
}
