/**
 * Follows each person from one count to the next, so Kyro can say how many
 * people arrived and how many left.
 *
 * Counting in a browser used to send zero for both, because it only ever looked
 * at one picture at a time. That became possible once a count took about a third
 * of a second instead of one and a half.
 *
 * Deliberately slow to believe anything. The earlier attempt on the camera
 * computer reported ten arrivals for someone who never moved, because every
 * flicker in the AI's detection looked like a person appearing. So:
 *
 *   - a new box must be seen SEEN_TO_CONFIRM counts in a row before it counts
 *     as someone arriving;
 *   - a person must be missing MISSING_TO_LEAVE counts in a row before they
 *     count as having left.
 *
 * Someone blinking in and out of the AI's view therefore changes nothing.
 */

export interface Box { box: [number, number, number, number] }
/** How alike two face codes are, 0–1 (see faceEngine). */
function alike(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i];
  return s;
}
/** Two codes this alike are the same person — measured on 600 standard face pairs. */
const SAME_FACE = 0.4;

// A score that rises when the person is seen and falls when they are not, so a
// box that only flickers in and out never reaches it. Simply totalling sightings
// wasn't enough: a false box appearing every other count still added up.
const SCORE_TO_CONFIRM = 3;
/**
 * How long someone must be out of sight before they count as having left.
 *
 * This was 8 counts (~2.5 s), which counted the same people in and out over and
 * over: turn away from the camera, or stand behind someone, and you had "left"
 * and then "arrived" again. In seconds rather than counts, so it doesn't change
 * with how fast the computer is.
 */
const GRACE_MS = 45_000;
/**
 * The same wait, at a doorway.
 *
 * Forty-five seconds is right for a room, where someone turning away or
 * standing behind a pillar must not be counted out and back in. At a door
 * people pass through in a couple of seconds, so that long a wait means the
 * morning's arrivals only appear three quarters of a minute after they
 * happened — and during a rush, barely at all.
 */
const DOOR_GRACE_MS = 6_000;
const SAME_PERSON_IOU = 0.3;   // overlap between counts that means "same person"
/** Someone who went out of sight and came back nearby is the same person, not a new arrival. */
const RETURN_WITHIN_WIDTHS = 3;

interface Track {
  id: number;
  box: [number, number, number, number];
  score: number;               // rises when seen, falls when missed
  missing: number;
  lastSeen: number;            // when they were last actually seen
  counted: boolean;            // already counted as someone who arrived
  face: Float32Array | null;   // their face code, when one could be read
  /** Where they were first seen, for a doorway camera to tell which way they went. */
  firstBox: [number, number, number, number];
}

/**
 * Which way is "in", as seen by a camera watching a doorway.
 *
 * "closer" means people coming in walk towards the camera, so their box grows.
 * "away" is the reverse. "left" and "right" are for a camera looking across a
 * doorway rather than along it.
 */
export type Inward = "closer" | "away" | "left" | "right";

/** Movement smaller than this is someone shifting their weight, not walking. */
const MOVED_ENOUGH = 0.25;   // of their own width, or a quarter again in size

/**
 * Which way one person went, or null if they didn't really go anywhere.
 *
 * A camera on a door cannot tell arrivals from departures by watching people
 * appear and disappear: everybody does both, whichever way they are walking.
 * That is why a door camera reported "12 in, 0 out" with people streaming
 * past in both directions. The direction of travel is the whole of the
 * information, so it is what gets counted.
 */
export function wentIn(
  first: [number, number, number, number],
  last: [number, number, number, number],
  inward: Inward,
): boolean | null {
  const cx = (b: [number, number, number, number]) => (b[0] + b[2]) / 2;
  const w = (b: [number, number, number, number]) => Math.max(1, b[2] - b[0]);
  const h = (b: [number, number, number, number]) => Math.max(1, b[3] - b[1]);

  if (inward === "left" || inward === "right") {
    const moved = cx(last) - cx(first);
    const enough = Math.max(w(first), w(last)) * MOVED_ENOUGH;
    if (Math.abs(moved) < enough) return null;
    const wentLeft = moved < 0;
    return inward === "left" ? wentLeft : !wentLeft;
  }

  // Walking towards the camera makes a person taller in the picture. Height is
  // steadier than width, which changes with how someone is standing.
  const grew = h(last) / h(first);
  if (grew > 1 - MOVED_ENOUGH && grew < 1 + MOVED_ENOUGH) return null;
  const cameCloser = grew > 1;
  return inward === "closer" ? cameCloser : !cameCloser;
}

/** Centre-to-centre distance, in multiples of the wider box's width. */
function apart(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ax = (a[0] + a[2]) / 2, ay = (a[1] + a[3]) / 2;
  const bx = (b[0] + b[2]) / 2, by = (b[1] + b[3]) / 2;
  const w = Math.max(a[2] - a[0], b[2] - b[0]) || 1;
  return Math.hypot(ax - bx, ay - by) / w;
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

export class PersonTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  entries = 0;
  exits = 0;
  /**
   * Set for a camera watching a doorway. Everyone passing a door both appears
   * and disappears, so appearing cannot mean "arrived" — only the direction
   * they walked can. While this is set, nobody is counted until they have gone
   * from view and it is clear which way they went.
   */
  private inward: Inward | null = null;

  /** null for a camera watching a room; a direction for one watching a door. */
  watchesDoorway(inward: Inward | null): void {
    if (this.inward !== inward) { this.inward = inward; this.entries = 0; this.exits = 0; }
  }

  /** Give it this count's people; returns how many are here now (confirmed only). */
  /**
   * @param faces one face code per person, same order, null where no clear face.
   *              With them, someone who went out of sight and came back is
   *              recognised rather than counted as arriving again.
   */
  update(people: Box[], now: number = Date.now(), faces?: (Float32Array | null)[]): number {
    const boxes = people.map((p) => p.box);
    const takenTrack = new Set<number>();
    const takenBox = new Set<number>();

    // Best overlaps first, so two people close together don't swap identities.
    const pairs: { t: number; b: number; score: number }[] = [];
    this.tracks.forEach((t, ti) => boxes.forEach((b, bi) => {
      const score = iou(t.box, b);
      if (score >= SAME_PERSON_IOU) pairs.push({ t: ti, b: bi, score });
    }));
    pairs.sort((x, y) => y.score - x.score);
    for (const { t, b } of pairs) {
      if (takenTrack.has(t) || takenBox.has(b)) continue;
      takenTrack.add(t); takenBox.add(b);
      const tr = this.tracks[t];
      tr.box = boxes[b]; tr.missing = 0; tr.lastSeen = now;
      if (faces?.[b]) tr.face = faces[b];
      tr.score = Math.min(SCORE_TO_CONFIRM + 2, tr.score + 1);
      if (!tr.counted && tr.score >= SCORE_TO_CONFIRM) { tr.counted = true; if (!this.inward) this.entries++; }
    }

    // Mark the misses BEFORE adding new tracks, or a brand-new one is counted
    // as missed in the very update that created it and thrown away at once.
    const existing = this.tracks.length;
    this.tracks.forEach((t, ti) => {
      if (ti >= existing || takenTrack.has(ti)) return;
      t.missing++;
      if (!t.counted) t.score--;     // a flickering box loses ground as fast as it gains it
    });

    boxes.forEach((b, bi) => {
      if (takenBox.has(bi)) return;
      // Before calling this a new arrival, see whether someone we lost recently
      // has simply come back — turned round, or stepped out and returned.
      let revive = -1;
      // A face is far better evidence than a position: someone can walk right
      // across the room and still be the same person.
      const mine = faces?.[bi] ?? null;
      if (mine) {
        let bestFace = SAME_FACE;
        this.tracks.forEach((t, ti) => {
          if (takenTrack.has(ti) || t.missing === 0 || !t.face) return;
          const s = alike(t.face, mine);
          if (s >= bestFace) { bestFace = s; revive = ti; }
        });
      }
      if (revive < 0) {
        let best = RETURN_WITHIN_WIDTHS;
        this.tracks.forEach((t, ti) => {
          if (takenTrack.has(ti) || t.missing === 0) return;
          const d = apart(t.box, b);
          const sizes = (t.box[3] - t.box[1]) / Math.max(1, b[3] - b[1]);
          if (d < best && sizes > 0.5 && sizes < 2) { best = d; revive = ti; }
        });
      }
      if (revive >= 0) {
        const t = this.tracks[revive];
        takenTrack.add(revive);
        t.box = b; t.missing = 0; t.lastSeen = now;
        if (mine) t.face = mine;
        t.score = Math.min(SCORE_TO_CONFIRM + 2, t.score + 1);
        if (!t.counted && t.score >= SCORE_TO_CONFIRM) { t.counted = true; if (!this.inward) this.entries++; }
        return;
      }
      this.tracks.push({ id: this.nextId++, box: b, firstBox: b, score: 1, missing: 0, lastSeen: now, counted: false, face: faces?.[bi] ?? null });
    });
    this.tracks = this.tracks.filter((t) => {
      if (!t.counted && t.score <= 0) return false;      // never convinced it was a person
      if (now - t.lastSeen < (this.inward ? DOOR_GRACE_MS : GRACE_MS)) return true;
      if (t.counted) {
        if (this.inward) {
          // A doorway: they have gone, so now we can say which way.
          const went = wentIn(t.firstBox, t.box, this.inward);
          if (went === true) this.entries++;
          else if (went === false) this.exits++;
          // null = they stood by the door and went back the way they came.
        } else {
          this.exits++;   // a room: only people we'd counted as arriving can leave
        }
      }
      return false;
    });

    return this.tracks.filter((t) => t.counted && t.missing === 0).length;
  }

  /** New day, or counting restarted. */
  reset(): void {
    this.tracks = []; this.entries = 0; this.exits = 0;
  }
}
