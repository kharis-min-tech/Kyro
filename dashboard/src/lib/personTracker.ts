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

  /** Give it this count's people; returns how many are here now (confirmed only). */
  update(people: Box[], now: number = Date.now()): number {
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
      tr.score = Math.min(SCORE_TO_CONFIRM + 2, tr.score + 1);
      if (!tr.counted && tr.score >= SCORE_TO_CONFIRM) { tr.counted = true; this.entries++; }
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
      let revive = -1, best = RETURN_WITHIN_WIDTHS;
      this.tracks.forEach((t, ti) => {
        if (takenTrack.has(ti) || t.missing === 0) return;
        const d = apart(t.box, b);
        const sizes = (t.box[3] - t.box[1]) / Math.max(1, b[3] - b[1]);
        if (d < best && sizes > 0.5 && sizes < 2) { best = d; revive = ti; }
      });
      if (revive >= 0) {
        const t = this.tracks[revive];
        takenTrack.add(revive);
        t.box = b; t.missing = 0; t.lastSeen = now;
        t.score = Math.min(SCORE_TO_CONFIRM + 2, t.score + 1);
        if (!t.counted && t.score >= SCORE_TO_CONFIRM) { t.counted = true; this.entries++; }
        return;
      }
      this.tracks.push({ id: this.nextId++, box: b, score: 1, missing: 0, lastSeen: now, counted: false });
    });
    this.tracks = this.tracks.filter((t) => {
      if (!t.counted && t.score <= 0) return false;      // never convinced it was a person
      if (now - t.lastSeen < GRACE_MS) return true;
      if (t.counted) this.exits++;     // only people we'd counted as arriving can leave
      return false;
    });

    return this.tracks.filter((t) => t.counted && t.missing === 0).length;
  }

  /** New day, or counting restarted. */
  reset(): void {
    this.tracks = []; this.entries = 0; this.exits = 0;
  }
}
