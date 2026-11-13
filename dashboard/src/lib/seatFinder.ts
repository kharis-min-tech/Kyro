/**
 * Kyro finds the seats by itself, in the browser — nobody draws them.
 *
 * A port of camera-box/kyro_box/seatfinder.py, which has done this on the
 * installed camera computer all along. The thresholds, the evidence and the
 * seat naming are deliberately the same: this is the same feature reaching the
 * cameras that are actually in use, not a second one that behaves differently.
 *
 * Two kinds of evidence, per camera:
 *
 *   1. Where people SIT. Somebody who stays in the same place across several
 *      separate checks spread over a minute and a half is sitting, so that
 *      place is a seat. People walking about never stay long enough.
 *
 *   2. Chairs, benches and sofas the AI recognises. The counting model already
 *      reports these on every single count — it is trained on eighty kinds of
 *      object and Kyro reads one row of its output, the "person" row, and
 *      throws the rest away. Reading the furniture rows costs no extra AI
 *      work at all, and finds the seats before anybody arrives to sit in them.
 *
 * Seats keep the same id for good (K1, K2 …) so the map doesn't jump about as
 * more are found, and everything is kept in this browser and survives a
 * reload.
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * It identifies SEATS, never people. A seat id and a person id are different
 * things and are never interchangeable: somebody who sits in five chairs
 * during a service is five seats and one person. Nothing here records who sat
 * anywhere, and nothing is kept between services about any individual.
 */

export type SeatStatus = "maybe" | "seat" | "uncertain" | "not_seat";
export type Box = [number, number, number, number];

/** Where Kyro publishes seats, and the picture the website's seat map expects. */
export const SEAT_W = 1280;
export const SEAT_H = 720;

// ── The same thresholds the camera computer uses ───────────────────────────
export const STAY_CHECKS = 4;          // seen in the same place on this many checks…
export const STAY_SPAN_MS = 90_000;    // …spread over at least this long = sitting
export const CHECK_GAP_MS = 15_000;    // checks closer than this count as one
export const SAME_PLACE_IOU = 0.45;    // this much overlap = the same place
export const CHAIR_EVERY_MS = 300_000; // look for empty chairs this often
export const CHAIR_CHECKS = 2;         // a chair seen this many times = a seat
export const STANDING_RATIO = 2.6;     // taller than this × wider = standing, so ask
export const MAX_SEATS = 800;          // what a stored seat list can hold
const ROWS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

// ── Occupancy ──────────────────────────────────────────────────────────────
/** A person has to be in a seat this long before it counts as taken. */
const SIT_DOWN_MS = 2_500;
/** And it stays theirs this long after they go, so leaning forward isn't leaving. */
const HOLD_MS = 45_000;
/** Somebody this much taller than the seat is standing in front of it, not in it. */
const TOO_TALL = 1.5;
/** Of the seat's area, how much a person must cover to be in it. */
const IN_SEAT = 0.25;
/** …and how little is enough to be the person AT it. See whoIsAt. */
const NEAR_SEAT = 0.12;
/** How long somebody at a seat must have stopped there to be its person
 *  rather than somebody on their way past. See whoIsAt. */
const STOPPED_MS = 1_500;

export interface Place {
  id: number;
  box: Box;
  checks: number[];
  chairs: number;
  status: SeatStatus;
  tall: number;
  seen: number;
  /** An administrator said so, and nothing automatic may overrule it. */
  decided?: boolean;
}

export interface Seat {
  seat_id: string; row: string; number: number; section: string; bbox: Box;
}

export type SeatState = "occupied" | "temporarily_vacant" | "available" | "unknown";

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy;
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
}
const areaOf = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function covered(seat: Box, person: Box): number {
  const ix = Math.max(0, Math.min(seat[2], person[2]) - Math.max(seat[0], person[0]));
  const iy = Math.max(0, Math.min(seat[3], person[3]) - Math.max(seat[1], person[1]));
  const a = areaOf(seat);
  return a > 0 ? (ix * iy) / a : 0;
}

/** The lower part of a person's box — roughly where they are standing. */
function footOf(b: Box): Box {
  const h = b[3] - b[1];
  return [b[0], b[3] - 0.35 * h, b[2], b[3]];
}

/** A chair's box → where a person sitting on it appears (the chair plus their upper body). */
export function chairToSeat(b: Box): Box {
  const h = b[3] - b[1];
  return [b[0], Math.max(0, b[1] - 1.1 * h), b[2], b[3]];
}

export class SeatFinder {
  places: Place[] = [];
  nextId = 1;
  stage: "top" | "bottom" = "top";
  /** When chairs were last looked for, so counting always comes first. */
  chairsAt = 0;
  private held = new Map<string, { since: number; left: number; person: number }>();

  constructor(readonly key: string) {}

  // ── Watching ─────────────────────────────────────────────────────────────

  /**
   * Where people are now. Boxes in the camera's own pixels, with the picture's
   * size, so every camera's seats end up in the same 1280×720 space the
   * website's seat map draws in.
   */
  sawPeople(boxes: Box[], w: number, h: number, now: number): void {
    for (const b of boxes) this.seen(this.toSeatSpace(b, w, h), now, "person");
  }

  /** Chairs, benches and sofas, the same way. */
  sawChairs(boxes: Box[], w: number, h: number, now: number): void {
    this.chairsAt = now;
    for (const b of boxes) this.seen(chairToSeat(this.toSeatSpace(b, w, h)), now, "chair");
  }

  /** Is it time to spend a count looking for furniture? Counting comes first. */
  wantsChairs(now: number): boolean {
    return now - this.chairsAt > CHAIR_EVERY_MS;
  }

  private toSeatSpace(b: Box, w: number, h: number): Box {
    const sx = SEAT_W / Math.max(1, w), sy = SEAT_H / Math.max(1, h);
    return [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy];
  }

  private seen(box: Box, now: number, how: "person" | "chair"): void {
    let best: Place | null = null, bestIou = SAME_PLACE_IOU;
    for (const p of this.places) {
      const i = iou(p.box, box);
      if (i > bestIou) { best = p; bestIou = i; }
    }
    if (!best) {
      if (this.places.length >= MAX_SEATS * 2) return;
      best = { id: this.nextId++, box, checks: [], chairs: 0, status: "maybe", tall: 0, seen: 0 };
      this.places.push(best);
    }
    if (how === "chair") { best.chairs++; return; }
    best.seen++;
    const w = box[2] - box[0], h = box[3] - box[1];
    if (w > 0 && h / w > STANDING_RATIO) best.tall++;
    // The place settles where people actually sit, until it is confirmed.
    if (best.status !== "seat") best.box = best.box.map((a, i) => 0.8 * a + 0.2 * box[i]) as Box;
    const last = best.checks[best.checks.length - 1];
    if (last === undefined || now - last >= CHECK_GAP_MS) best.checks = [...best.checks, now].slice(-20);
  }

  /**
   * Decide which places are seats.
   *
   * Someone standing very upright, or a place nowhere near any other seat, is
   * not taken on trust: it becomes "uncertain" for an administrator to confirm
   * or reject. The camera computer asks with a photograph; a browser has the
   * seat map instead, which is better — the whole lot can be seen at once.
   */
  decide(now: number): void {
    for (const p of this.places) {
      if (p.status !== "maybe" || p.decided) continue;
      const sat = p.checks.length >= STAY_CHECKS
        && p.checks[p.checks.length - 1] - p.checks[0] >= STAY_SPAN_MS;
      const chair = p.chairs >= CHAIR_CHECKS;
      if (!sat && !chair) continue;
      const standing = p.seen > 0 && p.tall / p.seen > 0.6;
      if ((standing || this.alone(p)) && !chair) { p.status = "uncertain"; continue; }
      p.status = "seat";
    }
    // Forget places nobody has been in for days that never became seats.
    this.places = this.places.filter((p) => p.status !== "maybe" || !p.checks.length
      || now - p.checks[p.checks.length - 1] < 3 * 86_400_000);
  }

  /** No other seat anywhere near — unusual in a hall full of chairs or pews. */
  private alone(p: Place): boolean {
    const w = p.box[2] - p.box[0];
    const cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2;
    const seats = this.places.filter((q) => q !== p && q.status === "seat");
    if (seats.length < 6) return false;
    return seats.every((q) => Math.abs((q.box[0] + q.box[2]) / 2 - cx) > 4 * w
      || Math.abs((q.box[1] + q.box[3]) / 2 - cy) > 3 * w);
  }

  // ── The seat list ────────────────────────────────────────────────────────

  /** Seats with rows (A nearest the stage) and numbers (left to right). Ids never change. */
  seats(): Seat[] {
    let found = this.places.filter((p) => p.status === "seat");
    if (!found.length) return [];
    if (found.length > MAX_SEATS) {
      found = [...found].sort((a, b) => (b.seen + 5 * b.chairs) - (a.seen + 5 * a.chairs)).slice(0, MAX_SEATS);
    }
    const heights = found.map((p) => p.box[3] - p.box[1]).sort((a, b) => a - b);
    const h = heights[Math.floor(heights.length / 2)] || 1;
    const mid = (p: Place) => (p.box[1] + p.box[3]) / 2;
    const order = [...found].sort((a, b) => (this.stage === "bottom" ? mid(b) - mid(a) : mid(a) - mid(b)));
    const rows: Place[][] = [];
    let row: Place[] = [order[0]];
    for (const p of order.slice(1)) {
      if (Math.abs(mid(p) - mid(row[row.length - 1])) > 0.45 * h) { rows.push(row); row = []; }
      row.push(p);
    }
    rows.push(row);
    const out: Seat[] = [];
    rows.forEach((members, r) => {
      const label = r < ROWS.length ? ROWS[r] : `R${r + 1}`;
      [...members].sort((a, b) => a.box[0] - b.box[0]).forEach((p, i) => {
        out.push({ seat_id: `K${p.id}`, row: label, number: i + 1, section: "Main",
          bbox: p.box.map((v) => Math.round(v * 10) / 10) as Box });
      });
    });
    return out;
  }

  // ── Who is sitting where ─────────────────────────────────────────────────

  /**
   * Which seats are taken, from where the people are.
   *
   * The traps, each one guarded:
   *
   *   - Somebody STANDING in front of a chair is not in it. They are much
   *     taller than the seat, so a person more than half as tall again is
   *     refused.
   *   - Somebody WALKING PAST a row does not fill it. A seat is only taken
   *     after a couple of seconds, so passing through changes nothing.
   *   - One person does not fill the seats either side of them. Each person
   *     takes at most one seat and each seat at most one person — the best
   *     overlaps first.
   *   - Leaning forward is not leaving. A seat stays theirs for the better
   *     part of a minute after they are lost, and reports as "temporarily
   *     vacant" rather than empty.
   */
  /**
   * Which person is in which seat, as far as this camera can see.
   *
   * Returned rather than kept, because WHO they are is not this file's
   * business: the seat finder knows about seats, the register knows about
   * people, and the only thing joining them is "the person in this box is in
   * that seat". See worker/identity.js.
   *
   * Each person takes at most one seat and each seat at most one person, best
   * overlaps first — so one person never fills the chairs either side of them,
   * and two people side by side take two seats.
   */
  whoIsWhere(people: Box[], w: number, h: number): { seatOfPerson: (string | null)[]; personOfSeat: Map<string, number> } {
    const seats = this.seats();
    const boxes = people.map((b) => this.toSeatSpace(b, w, h));
    const pairs: { s: number; p: number; score: number }[] = [];
    seats.forEach((seat, si) => {
      const sh = seat.bbox[3] - seat.bbox[1];
      boxes.forEach((person, pi) => {
        if (person[3] - person[1] > TOO_TALL * sh) return;     // standing in front of it
        const score = covered(seat.bbox, person);
        if (score >= IN_SEAT) pairs.push({ s: si, p: pi, score });
      });
    });
    pairs.sort((a, b) => b.score - a.score);
    const seatTaken = new Map<number, number>(), personUsed = new Set<number>();
    for (const { s, p } of pairs) {
      if (seatTaken.has(s) || personUsed.has(p)) continue;
      seatTaken.set(s, p); personUsed.add(p);
    }
    const seatOfPerson: (string | null)[] = people.map(() => null);
    const personOfSeat = new Map<string, number>();
    for (const [si, pi] of seatTaken) {
      seatOfPerson[pi] = seats[si].seat_id;
      personOfSeat.set(seats[si].seat_id, pi);
    }
    return { seatOfPerson, personOfSeat };
  }

  /**
   * Whoever is AT a seat — standing by it counts.
   *
   * Not the same question as whoIsWhere, and deliberately looser. That one
   * decides whether a seat is taken, where somebody standing in front of a
   * chair must NOT fill it: people walk past rows all morning and a count
   * that believes them is wrong.
   *
   * This one only picks whose picture to take when Kyro wants to ask "is
   * this the same person?" about two cameras' seats. "a person does not need
   * to sit down to show that thats there seat" — quite so. Somebody standing
   * at their place, taking their coat off, or leaning over the row in front
   * is plainly the person at that seat, and refusing to photograph them
   * until they sat down meant the question often went unasked.
   *
   * Nothing here can over-count anybody: the answer joins two seats or
   * leaves them alone, and the worst a bad pick can do is make a question
   * somebody answers "no" to.
   */
  whoIsAt(seatId: string, people: Box[], w: number, h: number, stillFor: number[] = []): number | null {
    const seat = this.seats().find((s) => s.seat_id === seatId)
      ?? (() => { const p = this.places.find((x) => `K${x.id}` === seatId); return p ? { bbox: p.box } : null; })();
    if (!seat) return null;
    let best: number | null = null, bestScore = NEAR_SEAT;
    people.forEach((b, i) => {
      const person = this.toSeatSpace(b, w, h);
      // Of the seat, how much this person stands over — and, for somebody
      // tall who covers it from above, whether their feet are at it.
      const score = Math.max(covered(seat.bbox, person), covered(seat.bbox, footOf(person)));
      if (score <= bestScore) return;
      /**
       * Somebody WALKING PAST the row is not the person at that seat.
       *
       * Standing in front of a chair covers it as thoroughly as sitting in
       * it — more, usually — so coverage alone cannot tell the two apart.
       * What tells them apart is that one of them has stopped. A picture of
       * somebody on their way past, put to a person as "is this the same
       * person?", gets an honest no, and two cameras looking at one chair
       * are then told to go on counting it twice.
       *
       * So everybody here has to have stood still a moment, seated or not.
       * Somebody who has only just arrived is simply photographed a few
       * seconds later: the question waits, and asks again.
       */
      if ((stillFor[i] ?? 0) < STOPPED_MS) return;
      bestScore = score; best = i;
    });
    return best;
  }

  occupancy(people: Box[], w: number, h: number, now: number): [string, SeatState, number, number][] {
    const seats = this.seats();
    const { personOfSeat } = this.whoIsWhere(people, w, h);
    const seatTaken = new Map<number, number>();
    seats.forEach((seat, si) => {
      const who = personOfSeat.get(seat.seat_id);
      if (who !== undefined) seatTaken.set(si, who);
    });
    return seats.map((seat, si) => {
      const who = seatTaken.get(si);
      const held = this.held.get(seat.seat_id);
      if (who !== undefined) {
        const since = held?.since ?? now;
        this.held.set(seat.seat_id, { since, left: 0, person: who });
        const settled = now - since >= SIT_DOWN_MS;
        return [seat.seat_id, settled ? "occupied" : "unknown", 0, settled ? 0.9 : 0.5];
      }
      if (held && held.since) {
        const left = held.left || now;
        this.held.set(seat.seat_id, { ...held, left });
        if (now - left < HOLD_MS) {
          return [seat.seat_id, "temporarily_vacant", Math.round((now - left) / 1000), 0.6];
        }
        this.held.delete(seat.seat_id);
      }
      return [seat.seat_id, "available", 0, 0.8];
    });
  }

  // ── An administrator's corrections, which nothing automatic may undo ─────

  confirm(id: number): void { this.set(id, "seat"); }
  reject(id: number): void { this.set(id, "not_seat"); }
  private set(id: number, status: SeatStatus): void {
    const p = this.places.find((x) => x.id === id);
    if (p) { p.status = status; p.decided = true; }
  }
  /** Remove a seat that no longer exists. Its id is never given to another seat. */
  remove(id: number): void { this.set(id, "not_seat"); }
  /** Correct where a seat is. */
  move(id: number, box: Box): void {
    const p = this.places.find((x) => x.id === id);
    if (p) { p.box = box; p.decided = true; }
  }
  /** Add one automatic discovery missed. */
  add(box: Box): number {
    const p: Place = { id: this.nextId++, box, checks: [], chairs: CHAIR_CHECKS, status: "seat", tall: 0, seen: 0, decided: true };
    this.places.push(p);
    return p.id;
  }
  /** Two records of one physical seat: keep the first, and never reuse the other's id. */
  merge(keep: number, drop: number): void {
    const a = this.places.find((x) => x.id === keep), b = this.places.find((x) => x.id === drop);
    if (!a || !b || a === b) return;
    a.seen += b.seen; a.chairs += b.chairs;
    a.checks = [...a.checks, ...b.checks].sort((x, y) => x - y).slice(-20);
    b.status = "not_seat"; b.decided = true;
  }

  /** Everything an administrator might be asked about. */
  uncertain(): Place[] { return this.places.filter((p) => p.status === "uncertain"); }

  // ── Kept in this browser, and surviving a reload ─────────────────────────
  save(): string {
    return JSON.stringify({ places: this.places, nextId: this.nextId, stage: this.stage });
  }
  load(text: string | null): void {
    if (!text) return;
    try {
      const d = JSON.parse(text);
      if (Array.isArray(d.places)) this.places = d.places;
      if (typeof d.nextId === "number") this.nextId = Math.max(1, d.nextId);
      if (d.stage === "bottom" || d.stage === "top") this.stage = d.stage;
    } catch { /* a corrupt note is no note */ }
  }
}
