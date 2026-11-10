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
  /** A tile box taller than this share of the picture is a "near" person. */
  nearHeight?: number;
  /** Drop a near tile box whose overlap with a whole-picture box covers this share of it. */
  nearOverlap?: number;
  /** The model's input size (640, or 1280 for the high-detail model). */
  size?: number;
  /** false = skip tidy() (only for measuring what tidy() changes; see ai/eval). */
  tidy?: boolean;
}

/** A person counts when the model is at least this sure. Chosen on the tuning
 *  half of ai/eval's hand-labelled test set (410 frames, 2,034 people): with
 *  tidy(), 0.3 gave the lowest headcount error; 0.2 counted many objects and
 *  body parts as people, 0.35+ started missing real people. Same as the Camera Box. */
export const COUNT_CONFIDENCE = 0.3;
/** A box this sure or more can "contain" a part-of-a-person box (tidy()). */
const PART_CONTAINER_MIN = 0.2;

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

/**
 * Which rows of the model's output are worth reading.
 *
 * The model is trained on eighty kinds of object and reports all of them, in
 * one run, every time. Kyro read row 4 — "person" — and threw the other
 * seventy-nine away. Three of them are seats: bench, chair and sofa, the same
 * three the camera computer uses to find seating automatically. Reading them
 * costs no extra AI work whatsoever; they have been produced and discarded on
 * every count Kyro has ever done.
 *
 * Row = 4 + the object's number, because the first four rows are the box.
 */
export const PERSON_ROW = 4;
export const SEATING_ROWS = [4 + 13, 4 + 56, 4 + 57];   // bench, chair, sofa

/** Raw YOLO output → boxes in picture coordinates, from one row of it. */
function decodeRow(out: Float32Array, row: number, r: number, ox: number, oy: number, sx: number, sy: number, minScore: number): Person[] {
  const n = out.length / 84;  // 8400 candidates
  const found: Person[] = [];
  for (let i = 0; i < n; i++) {
    const score = out[row * n + i];
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

function decode(out: Float32Array, r: number, ox: number, oy: number, sx: number, sy: number, minScore: number): Person[] {
  return decodeRow(out, PERSON_ROW, r, ox, oy, sx, sy, minScore);
}

/**
 * Chairs, benches and sofas in the same output — for finding the seats.
 *
 * Deliberately a separate call on a result Kyro already has, so that nothing
 * about counting people changes: the person boxes come from exactly the same
 * place they always did.
 */
export function decodeSeating(out: Float32Array, r: number, ox: number, oy: number, sx: number, sy: number, minScore = 0.35): Person[] {
  const all: Person[] = [];
  for (const row of SEATING_ROWS) all.push(...decodeRow(out, row, r, ox, oy, sx, sy, minScore));
  return nms(all, 0.45);
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

/**
 * Chairs, benches and sofas in one look at the whole picture.
 *
 * One AI run, no tiles: finding furniture is a bonus and must never take time
 * from counting people. It is asked for every few minutes, not every count —
 * chairs do not move about.
 */
export async function detectSeating(px: Pixels, run: RunModel, opts: DetectOptions = {}): Promise<Person[]> {
  const size = opts.size ?? MODEL_SIZE;
  const { tensor, r, ox, oy } = toTensor(px, 0, 0, px.width, px.height, size);
  return decodeSeating(await run(tensor), r, ox, oy, 0, 0, opts.minScore ?? 0.35);
}

export async function detectPeople(px: Pixels, run: RunModel, opts: DetectOptions = {}): Promise<Person[]> {
  const minScore = opts.minScore ?? 0.1;
  const size = opts.size ?? MODEL_SIZE;
  const pass = async (sx: number, sy: number, sw: number, sh: number) => {
    await new Promise((r) => setTimeout(r, 0));   // let the page handle clicks between looks
    const { tensor, r, ox, oy } = toTensor(px, sx, sy, sw, sh, size);
    return decode(await run(tensor), r, ox, oy, sx, sy, minScore);
  };

  const whole = await pass(0, 0, px.width, px.height);
  const grid = tileGrid(px, opts.tiles ?? "auto", size);
  const finish = (list: Person[]) => (opts.tidy === false ? list : tidy(list, px.height));
  if (grid <= 1) return finish(whole);

  const W = px.width, H = px.height, ov = opts.tileOverlap ?? 0.25;
  const tw = Math.floor(W / (grid - (grid - 1) * ov)), th = Math.floor(H / (grid - (grid - 1) * ov));
  const all: (Person & { edge: boolean; tile?: boolean })[] = whole.map((p) => ({ ...p, edge: false }));
  // People near the camera are big in the picture: the whole-picture pass
  // already sees them well, and a tile only sees part of them (and can count
  // the same person again from another tile). The tiles are there for small,
  // far-away people — so a big tile box that the whole picture already
  // explains is dropped.
  const nearH = (opts.nearHeight ?? 0.18) * H, nearOv = opts.nearOverlap ?? 0.5;
  const explained = (b: Person["box"]) => whole.some((q) => overlap(b, q.box) / (area(b) || 1) > nearOv);
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = Math.floor(((W - tw) * gx) / (grid - 1)), y = Math.floor(((H - th) * gy) / (grid - 1));
      const m = 3;
      for (const p of await pass(x, y, tw, th)) {
        const [x1, y1, x2, y2] = p.box;
        // Cut off by an INNER tile edge (not the picture's edge) → maybe half a person.
        const edge = (x1 <= x + m && x > 0) || (y1 <= y + m && y > 0) || (x2 >= x + tw - m && x + tw < W) || (y2 >= y + th - m && y + th < H);
        if ((y2 - y1 > nearH || edge) && explained(p.box)) continue;
        all.push({ ...p, edge, tile: true });
      }
    }
  }
  const merged = nms(all, opts.mergeIou ?? 0.55);
  const containment = opts.mergeContainment ?? 0.6;
  // Drop a tile-edge fragment lying mostly inside a bigger box. Only fragments:
  // someone sitting behind another person also lies inside their box.
  return finish(merged
    .filter((p) => !p.edge || !merged.some((q) => q !== p && area(q.box) >= area(p.box) * 1.3 && overlap(p.box, q.box) / (area(p.box) || 1) > containment))
    .map(({ box, score }) => ({ box, score })));
}

/** A box the AI is fairly sure is a whole person. */
const SURE = 0.5;

/**
 * Nothing this much wider than it is tall is a person.
 *
 * A pile of blankets on a bed was counted as one. The box was about three
 * times wider than it was tall, which no person standing, sitting, kneeling or
 * walking is — and the AI was reasonably confident, so every other check
 * passed it. The one check nobody had written was the shape of a human being.
 *
 * Generous on purpose, because a camera looking straight down at a doorway —
 * which is the mounting Kyro asks for — sees people from above, where somebody
 * with their arms out can be half again as wide as they are long. Twice as
 * wide is already unusual; nearly three times is a sofa, a bed, a table or a
 * pile of washing.
 */
const WIDEST_PERSON = 2.2;
/** Between this and WIDEST_PERSON, only a confident box counts. */
const WIDE_NEEDS_SURE = 1.5;

/**
 * Removes the AI's unsure guesses that aren't extra people — the cause of one
 * person near the camera being counted twice:
 *  - a big box it's unsure about: people near the camera are clearly visible,
 *    so the AI is sure of them; an unsure big box is a part of someone (an arm,
 *    a shoulder) or a box straddling two people;
 *  - an unsure wide, flat box inside a person it IS sure about: their hands,
 *    lap, bag or a table edge — not a person's shape;
 *  - a box for just someone's top half inside the box for all of them.
 * Unsure person-shaped boxes are kept even inside someone else's box: in a
 * crowd, the people behind (a choir behind someone with raised arms) look like that.
 */
export function tidy(people: Person[], frameH: number, bigHeight = 0.25, bigMinScore = 0.4): Person[] {
  // The same person twice: a box for just their top half inside a box for all
  // of them — at least half as wide, starting at the same head height (however sure
  // the AI is of both). Someone behind them is narrower or sticks out.
  const halfOf = (p: Person, q: Person) => p !== q && q.score >= PART_CONTAINER_MIN && area(q.box) >= area(p.box) * 1.3
    && overlap(p.box, q.box) / (area(p.box) || 1) >= 0.9 && Math.abs(p.box[1] - q.box[1]) <= 0.1 * (q.box[3] - q.box[1])
    && p.box[2] - p.box[0] >= 0.5 * (q.box[2] - q.box[0]);
  const whole: Person[] = [];
  for (const p of [...people].sort((a, b) => area(b.box) - area(a.box))) if (!whole.some((q) => halfOf(p, q))) whole.push(p);
  people = people.filter((p) => whole.includes(p));
  const sure = people.filter((p) => p.score >= SURE);
  return people.filter((p) => {
    const [bx1, by1, bx2, by2] = p.box;
    // The shape of a human being. Checked before anything else, because this
    // is the one thing no amount of confidence can make true: a box three
    // times wider than it is tall is furniture, however sure the AI is of it.
    const ratio = (bx2 - bx1) / Math.max(1, by2 - by1);
    if (ratio > WIDEST_PERSON) return false;
    if (ratio > WIDE_NEEDS_SURE && p.score < SURE) return false;
    if (p.score >= SURE) return true;
    const [x1, y1, x2, y2] = p.box;
    if (y2 - y1 > bigHeight * frameH && p.score < bigMinScore) return false;
    const wide = x2 - x1 > 1.6 * (y2 - y1);
    return !(wide && sure.some((q) => area(q.box) >= area(p.box) * 1.5 && overlap(p.box, q.box) / (area(p.box) || 1) > 0.85));
  });
}

/**
 * Leaves out people lying mostly (≥ 70%) inside "don't count this area"
 * rectangles (0–1 fractions of the picture) — e.g. a statue an admin marked.
 * Someone walking in front of it only partly overlaps, so they still count.
 * Same rule as in_ignore_zone() in ai/detection/detector.py.
 */
export function outsideZones(people: Person[], zones: [number, number, number, number][] | undefined, w: number, h: number): Person[] {
  if (!zones?.length) return people;
  return people.filter(({ box: [x1, y1, x2, y2] }) => {
    const a = Math.max((x2 - x1) * (y2 - y1), 1e-6);
    const inside = Math.max(...zones.map(([zx1, zy1, zx2, zy2]) =>
      Math.max(0, Math.min(x2, zx2 * w) - Math.max(x1, zx1 * w)) * Math.max(0, Math.min(y2, zy2 * h) - Math.max(y1, zy1 * h))));
    return inside / a < 0.7;
  });
}

/**
 * How much of `b` lies inside `a`, 0–1.
 *
 * Not IoU: this is one-sided on purpose. Two people standing close together
 * overlap a little and neither is INSIDE the other. A photograph of people on
 * a phone screen is entirely inside the box round the person holding it.
 */
function containedIn(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = Math.max((b[2] - b[0]) * (b[3] - b[1]), 1e-6);
  return (ix * iy) / area;
}

/** This much of a detection inside a bigger one, and it is not a separate person. */
export const INSIDE_SOMEBODY = 0.85;
/** …and it has to be this much smaller, or two people really are overlapping. */
export const MUCH_SMALLER = 0.4;

/**
 * People a person is carrying are not people.
 *
 * ── What happened ─────────────────────────────────────────────────────────
 *
 * "i put my phone towards the camera showing two people / a picture, and it
 * counted it, now my data is wrong".
 *
 * The AI is asked "where are the people in this picture", and it answers
 * correctly: there are people in the picture. Two of them are on a phone
 * screen. It has no way to know the difference and it is not being asked to.
 *
 * But the geometry gives it away, and gives it away cleanly. A photograph of
 * people held up to a camera sits ENTIRELY INSIDE the box round the person
 * holding it, and is much smaller. Two real people standing close together
 * do not do that: however much they overlap, each one's head is above the
 * other's shoulders or their feet are below — neither is swallowed whole.
 *
 * So a detection almost completely inside a much larger one is whatever that
 * person is holding, wearing or standing in front of: a phone, a magazine, a
 * printed order of service with a photograph on it, a baby's doll. It is not
 * counted.
 *
 * This is a rule about shapes, not a judgement about what something is — it
 * cannot tell a pillow from a person, because a pillow is not inside
 * anybody. See the stillness check in personTracker.ts for that one.
 */
export function notHeldBySomebody(people: Person[]): Person[] {
  if (people.length < 2) return people;
  const area = (b: [number, number, number, number]) => Math.max((b[2] - b[0]) * (b[3] - b[1]), 1e-6);
  return people.filter((p, i) =>
    !people.some((other, j) =>
      j !== i
      && area(p.box) < area(other.box) * MUCH_SMALLER
      && containedIn(other.box, p.box) >= INSIDE_SOMEBODY));
}

/** Smooths the headcount: the middle of the last few readings, so one odd picture doesn't make it jump. */
export class SteadyCount {
  private readings: number[] = [];
  private size: number;
  constructor(size = 5) { this.size = size; }
  add(n: number): number {
    this.readings.push(n);
    if (this.readings.length > this.size) this.readings.shift();
    const s = [...this.readings].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
}
